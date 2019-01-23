'use strict';

/**
 * Page revision API module
 *
 * Main tasks:
 * - keep track of titles, and provide listings for them
 * - keep track of MediaWiki revisions and their metadata
 * - translate MediaWiki revisions into timeuuid ranges for property queries
 * - detect edit conflicts
 */

const HyperSwitch = require('hyperswitch');
const HTTPError = HyperSwitch.HTTPError;
const URI = HyperSwitch.URI;
const TimeUuid = require('cassandra-uuid').TimeUuid;
const mwUtil = require('../lib/mwUtil');
const stringify = require('json-stable-stringify');

const spec = HyperSwitch.utils.loadSpec(`${__dirname}/page_revisions.yaml`);

const tableName = 'title_revisions-ng';

// Title Revision Service
class PRS {
    constructor(options) {
        this.options = options;
    }

    tableURI(domain) {
        return new URI([domain, 'sys', 'table', tableName, '']);
    }

    // Get the schema for the revision table
    getTableSchema() {
        return {
            table: tableName,
            version: 2,
            attributes: {
                title: 'string',
                page_id: 'int',
                rev: 'int',
                tid: 'timeuuid',
                namespace: 'int',
                // revision deletion or suppression, can be:
                // - sha1hidden, commenthidden, texthidden
                restrictions: 'set<string>',
                // Revision tags. Examples:
                // - minor revision
                tags: 'set<string>',
                user_id: 'int',
                user_text: 'string',
                timestamp: 'timestamp',
                comment: 'string',
                redirect: 'boolean',
                page_deleted: 'int',
                page_language: 'string'
            },
            index: [
                { attribute: 'title', type: 'hash' },
                { attribute: 'rev', type: 'range', order: 'desc' },
                { attribute: 'page_deleted', type: 'static' }
            ]
        };
    }

    fetchAndStoreMWRevision(hyper, req) {
        const rp = req.params;
        return this.fetchMWRevision(hyper, req)
        // Check if the same revision is already in storage
        .then((revision) => hyper.get({
            uri: this.tableURI(rp.domain),
            body: {
                table: tableName,
                attributes: {
                    title: revision.title,
                    rev: revision.rev
                }
            }
        })
        .then((res) => {
            const sameRev = res && res.body.items &&
                res.body.items.length > 0 &&
                this._checkSameRev(revision, res.body.items[0]);
            if (!sameRev) {
                throw new HTTPError({ status: 404 });
            }
        })
        .catch({ status: 404 }, () => {
            if (!revision.page_deleted) {
                // Clear up page_deleted
                revision.page_deleted = null;
            }

            return hyper.put({ // Save / update the revision entry
                uri: this.tableURI(rp.domain),
                body: {
                    table: tableName,
                    // TODO: Workaround for a bug in sqlite that stringifies the array
                    // in place while saving.
                    attributes: Object.assign({}, revision)
                }
            });
        })
        .then(() => {
            this._checkRevReturn(revision);
            return {
                status: 200,
                headers: {
                    etag: mwUtil.makeETag(revision.rev, revision.tid)
                },
                body: {
                    items: [revision]
                }
            };
        }));
    }

    getTitleRevision(hyper, req) {
        const rp = req.params;
        let revisionRequest;
        const titleRevisionRequest = () => {
            const revReqObject = {
                uri: this.tableURI(rp.domain),
                body: {
                    table: tableName,
                    attributes: {
                        title: rp.title
                    },
                    limit: 1
                }
            };
            if (rp.revision) {
                revReqObject.body.attributes.rev = parseInt(rp.revision, 10);
            }
            return hyper.get(revReqObject);
        };

        if (rp.revision && !/^[0-9]+$/.test(rp.revision)) {
            throw new HTTPError({
                status: 400,
                body: {
                    message: `Invalid revision: ${rp.revision}`
                }
            });
        }

        if (mwUtil.isNoCacheRequest(req)) {
            revisionRequest = this.fetchAndStoreMWRevision(hyper, req)
            .catch({ status: 404 },
                (e) => titleRevisionRequest()
                // In case 404 is returned by MW api, the page is deleted
                // TODO: Handle this directly with more targeted page
                // deletion/ un-deletion events.
                .then((result) => {
                    result = result.body.items[0];
                    result.tid = TimeUuid.now().toString();
                    result.page_deleted = result.rev;
                    // TODO: Object.assign here is to avoid a bug in sqlite
                    // backend that modifies original attribute.
                    return hyper.put({
                        uri: this.tableURI(rp.domain),
                        body: {
                            table: tableName,
                            attributes: Object.assign({}, result)
                        }
                    }).throw(e);
                }));
        } else {
            revisionRequest = titleRevisionRequest()
            .catch({ status: 404 }, () => this.fetchAndStoreMWRevision(hyper, req));
        }
        return revisionRequest
        .then((res) => {
            // TODO: temprorary code to ensure all revision responces
            // have the pagelanguage property set.
            if (res.body.items.length && !res.body.items[0].page_language) {
                if (mwUtil.isNoCacheRequest(req)) {
                    hyper.logger.log('error/pagelanguage', {
                        msg: 'Failed to fetch pagelanguage',
                        page_title: rp.title,
                        page_revision: rp.revision
                    });
                } else {
                    req.headers = req.headers || {};
                    req.headers['cache-control'] = 'no-cache';
                    return this.getTitleRevision(hyper, req);
                }
            }
            // End of temporary code

            // Check if the revision has any restrictions
            this._checkRevReturn(res.body.items.length && res.body.items[0]);

            // Clear paging info
            delete res.body.next;

            if (!res.headers) {
                res.headers = {};
            }
            const info = res.body.items[0];
            res.headers.etag = mwUtil.makeETag(info.rev, info.tid);
            return res;
        });
    }

    listTitleRevisions(hyper, req) {
        const rp = req.params;
        const revisionRequest = {
            table: tableName,
            attributes: {
                title: rp.title
            },
            proj: ['rev'],
            limit: hyper.config.default_page_size
        };
        if (req.query.page) {
            revisionRequest.next = mwUtil.decodePagingToken(hyper, req.query.page);
        }
        return hyper.get({
            uri: this.tableURI(rp.domain),
            body: revisionRequest
        })
        .then((res) => {
            // Flatten to an array of revisions rather than an array of objects &
            // perform some ghetto uniquification.
            const items = [];
            let lastRev;
            res.body.items.forEach((row) => {
                if (lastRev !== row.rev) {
                    items.push(row.rev);
                    lastRev = row.rev;
                }
            });
            if (res.body.next) {
                res.body._links = {
                    next: {
                        href: `?page=${mwUtil.encodePagingToken(hyper, res.body.next)}`
                    }
                };
            }
            res.body.items = items;
            return res;
        });
    }

    /**
     * Checks the revision info returned from the storage/MW API
     * for restrictions, and if there are any, acts appropriately:
     *  - page_deleted: raise 404 error
     *  - sha1hidden or texthidden: raise 403 error
     *  - commenthidden: remove comment field from response
     *  - userhidden: remove user information from response
     * @param  {Object} item the revision item
     * @throws               HTTPError if access to the revision should be denied
     */
    _checkRevReturn(item) {
        mwUtil.applyAccessChecks(item);
        if (item && Array.isArray(item.restrictions) && item.restrictions.length > 0) {
            // Check if user/comment data should be removed from response
            if (item.restrictions.indexOf('userhidden') >= 0) {
                delete item.user_id;
                delete item.user_text;
            }
            if (item.restrictions.indexOf('commenthidden') >= 0) {
                delete item.comment;
            }
        }
    }

    listTitles(hyper, req) {
        const rp = req.params;
        const listReq = {
            uri: new URI([rp.domain, 'sys', 'action', 'query']),
            method: 'post',
            body: {
                generator: 'allpages',
                gaplimit: hyper.config.default_page_size,
                prop: 'revisions',
                format: 'json'
            }
        };

        if (req.query.page) {
            Object.assign(listReq.body, mwUtil.decodePagingToken(hyper, req.query.page));
        }

        return hyper.get(listReq)
        .then((res) => {
            const pages = res.body.items;
            const items = [];

            Object.keys(pages).forEach((pageId) => {
                const article = pages[pageId];
                items.push(article.title);
            });

            let next = {};
            if (res.body.next) {
                next = {
                    next: {
                        href: `?page=${mwUtil.encodePagingToken(hyper, res.body.next)}`
                    }
                };
            }

            return {
                status: 200,
                body: {
                    items,
                    _links: next
                }
            };
        });
    }

    /**
     * Checks if two revisions are the same, ignoring different tid values.
     * @private
     * @param  {Object}  firstRev
     * @param  {Object}  secondRev
     * @return {boolean}            true if the same; false else
     */
    _checkSameRev(firstRev, secondRev) {
        const normalizeRev = (rev) => {
            const result = {};
            Object.keys(rev).forEach((key) => {
                const value = rev[key];
                // Ignore the tid attribute
                // Ignore all falsy values, as well as an empty array
                if (key === 'tid' || !value || (Array.isArray(value) && !value.length)) {
                    return;
                }

                if (key === 'timestamp') {
                    // 'timestamp' fields need to be parsed because Cassandra
                    // returns a ISO8601 ts which includes milliseconds, while
                    // the ts returned by MW API does not
                    result[key] = Date.parse(value);
                } else {
                    result[key] = value;
                }
            });
            return result;
        };
        return stringify(normalizeRev(firstRev)) === stringify(normalizeRev(secondRev));
    }

    fetchMWRevision(hyper, req) {
        const rp = req.params;
        // Try to resolve MW oldids to tids
        const apiReq = {
            uri: new URI([rp.domain, 'sys', 'action', 'query']),
            body: {
                format: 'json',
                action: 'query',
                prop: 'info|revisions',
                continue: '',
                rvprop: 'ids|timestamp|user|userid|size|sha1|comment|tags'
            }
        };
        if (/^[0-9]+$/.test(rp.revision)) {
            apiReq.body.revids = rp.revision;
        } else {
            apiReq.body.titles = rp.title;
        }
        return hyper.post(apiReq)
        .then((apiRes) => {
            const items = apiRes.body.items;
            if (!items.length || !items[0].revisions) {
                throw new HTTPError({
                    status: 404,
                    body: {
                        type: 'not_found',
                        description: 'Page or revision not found.',
                        apiResponse: apiRes
                    }
                });
            }
            // The response item
            const dataResp = apiRes.body.items[0];

            // Re-normalize title returned by MW.
            // - Gendered namespaces converted to gender-neutral version
            // - Title text format with spaces converted to underscores
            // - Check whether it's still the same title to avoid non-needed
            //   normalizations like + => space
            return mwUtil.normalizeTitle(hyper, req, dataResp.title)
            .then((normTitle) => {
                normTitle = normTitle.getPrefixedDBKey();
                if (rp.title && rp.title !== normTitle) {
                    throw new HTTPError({
                        status: 404,
                        body: {
                            type: 'not_found',
                            description: 'Requested page does not exist.'
                        }
                    });
                }
                // The revision info
                const apiRev = dataResp.revisions[0];
                // Are there any restrictions set?
                // FIXME: test for the precise attributes instead, this can easily
                // break if new keys are added.
                const restrictions = Object.keys(apiRev).filter((key) => /hidden$/.test(key));

                return {
                    title: normTitle,
                    page_id: parseInt(dataResp.pageid, 10),
                    rev: parseInt(apiRev.revid, 10),
                    tid: TimeUuid.now().toString(),
                    namespace: parseInt(dataResp.ns, 10),
                    user_id: restrictions.indexOf('userhidden') < 0 ? apiRev.userid : null,
                    user_text: restrictions.indexOf('userhidden') < 0 ? apiRev.user : null,
                    timestamp: apiRev.timestamp,
                    comment: restrictions.indexOf('commenthidden') < 0 ? apiRev.comment : null,
                    tags: apiRev.tags,
                    restrictions,
                    page_language: dataResp.pagelanguage,
                    // Get the redirect property, it's inclusion means true
                    // FIXME: Figure out redirect strategy: https://phabricator.wikimedia.org/T87393
                    redirect: dataResp.redirect !== undefined
                };
            });
        });
    }
}

module.exports = (options) => {
    const prs = new PRS(options);
    // XXX: add docs
    return {
        spec,
        operations: {
            listTitles: prs.listTitles.bind(prs),
            listTitleRevisions: prs.listTitleRevisions.bind(prs),
            getTitleRevision: prs.getTitleRevision.bind(prs)
        },
        resources: [
            {
                // Revision table
                uri: `/{domain}/sys/table/${tableName}`,
                body: prs.getTableSchema()
            }
        ]
    };
};
