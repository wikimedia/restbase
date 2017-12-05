"use strict";

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
const P = require('bluebird');

const spec = HyperSwitch.utils.loadSpec(`${__dirname}/page_revisions.yaml`);

const tableName = 'title_revisions-ng';

/**
 * The name of the suppression table
 * @type {string}
 * @const
 */
const restrictionsTableName = 'page_restrictions';

// Title Revision Service
class PRS {
    constructor(options) {
        this.options = options;
    }

    tableURI(domain) {
        return new URI([domain, 'sys', 'table3', tableName, '']);
    }

    // Get the schema for the revision table
    getTableSchema() {
        return {
            table: tableName,
            version: 1,
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
                page_deleted: 'int'
            },
            index: [
                { attribute: 'title', type: 'hash' },
                { attribute: 'rev', type: 'range', order: 'desc' },
                { attribute: 'page_deleted', type: 'static' }
            ]
        };
    }

    /**
     * Suppression table schema
     * @type {Object}
     * @const
     */
    restrictionsTableSchema() {
        return {
            table: restrictionsTableName,
            version: 2,
            attributes: {
                title: 'string',
                rev: 'int',
                restrictions: 'set<string>',
                redirect: 'string',
                page_deleted: 'int'
            },
            index: [
                { attribute: 'title', type: 'hash' },
                { attribute: 'rev', type: 'range', order: 'desc' },
                { attribute: 'page_deleted', type: 'static' }
            ]
        };
    }

    /**
     * Returns the suppression table URI for a given domain
     * @param {string} domain the domain
     * @return {URI} suppression table URI
     */
    restrictionsTableURI(domain) {
        return new URI([domain, 'sys', 'table3', restrictionsTableName, '']);
    }

    getRestrictions(hyper, req) {
        const rp = req.params;
        const attributes = { title: rp.title };
        if (rp.revision) {
            attributes.rev = {
                le: rp.revision
            };
        }
        return hyper.get({
            uri: this.restrictionsTableURI(rp.domain),
            body: {
                table: restrictionsTableName,
                attributes,
                limit: 1
            }
        })
        .then((res) => {
            // Remove possible revision restrictions as here we just need
            // the page deletion info
            const restrictions = res.body && res.body.items && res.body.items[0] || null;
            if (restrictions) {
                if (rp.revision && parseInt(restrictions.rev, 10) !== parseInt(rp.revision, 10)) {
                    restrictions.restrictions = [];
                    restrictions.redirect = undefined;
                }
                res.body = restrictions;
            } else {
                res.body = null;
            }
            return res;
        });
    }

    /**
     * Update restrictions for a title & revision. Used primarily by the parsoid
     * module to update redirects on save.
     */
    postRestrictions(hyper, req) {
        const rp = req.params;
        // Validate the request body
        const body = req.body;
        if (!body || !(body.restrictions || body.redirect)) {
            throw new HTTPError({
                status: 400,
                body: {
                    type: 'bad_request',
                    description: 'Expected restrictions or redirect in the POST body.',
                }
            });
        }
        const revision = {
            title: rp.title,
            rev: rp.revision,
        };
        Object.assign(revision, body);
        return this.storeRestrictions(hyper, req, revision);
    }

    storeRestrictions(hyper, req, revision) {
        const rp = req.params;
        // Do not even define attributes we don't want to overwrite.
        const restrictionObject = {};
        if (revision.restrictions && revision.restrictions.length) {
            restrictionObject.restrictions = revision.restrictions;
        }
        // Only accept new-style redirect parameters that are strings, but ignore
        // `true` flags as passed from MW API redirect responses (from
        // storePageDeletion and fetchAndStoreMWRevision).
        if (revision.redirect !== true && revision.redirect) {
            restrictionObject.redirect = revision.redirect;
        }
        if (revision.page_deleted) {
            restrictionObject.page_deleted = revision.page_deleted;
        }
        if (Object.keys(restrictionObject).length) {
            // Have restrictions or a redirect. Update storage.
            const attributes = {
                title: revision.title,
                rev: revision.rev
            };
            Object.assign(attributes, restrictionObject);
            return hyper.put({
                uri: this.restrictionsTableURI(rp.domain),
                body: {
                    table: restrictionsTableName,
                    attributes
                }
            });
        } else {
            // New restrictions are not specified. To avoid filling the
            // table with useless data first check whether there were
            // some restrictions stored before and overwrite only if needed
            return this.getRestrictions(hyper, {
                params: {
                    domain: rp.domain,
                    title: revision.title,
                    rev: revision.rev
                }
            })
            .then((res) => {
                const oldRestriction = res.body;
                if (oldRestriction.restrictions && oldRestriction.restrictions.length
                        || oldRestriction.page_deleted) {
                    // There were restrictions before. Record absence of
                    // restrictions.
                    return hyper.put({
                        uri: this.restrictionsTableURI(rp.domain),
                        body: {
                            table: restrictionsTableName,
                            attributes: {
                                title: revision.title,
                                rev: revision.rev,
                                restrictions: [],
                                // TODO: Reset page_deleted to actual start
                                // revision!
                                page_deleted: null,
                            }
                        }
                    });
                }
                return P.resolve({ status: 200 });
            })
            // No restrictions before & after. Nothing to do.
            .catchReturn({ status: 404 }, { status: 200 });
        }
    }

    storePageDeletion(hyper, req, revision) {
        return this.storeRestrictions(hyper, req, {
            title: req.params.title,
            // We're storing page_deletions with magic 0 rev just to update the static column
            // 0 is used to allow "LE" query always find at least something if no restrictions
            // are present for a particular revision.
            rev: 0,
            page_deleted: revision.page_deleted
        });
    }

    fetchAndStoreMWRevision(hyper, req) {
        const rp = req.params;
        return this.fetchMWRevision(hyper, req)
        .then(revision => // Check if the same revision is already in storage
            P.join(
                hyper.get({
                    uri: this.tableURI(rp.domain),
                    body: {
                        table: tableName,
                        attributes: {
                            title: revision.title,
                            rev: revision.rev
                        }
                    }
                }),
                // TODO: Before we fill in the restrictions table we need
                // to store the restriction regardless of the revision change

                this.storeRestrictions(hyper, req, revision)
            )
            .spread((res) => {
                const sameRev = res && res.body.items
                    && res.body.items.length > 0
                    && this._checkSameRev(revision, res.body.items[0]);
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
                        items: [ revision ]
                    }
                };
            })
        );
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
                e => titleRevisionRequest()
                // In case 404 is returned by MW api, the page is deleted
                // TODO: Handle this directly with more targeted page
                // deletion/ un-deletion events.
                .then((result) => {
                    result = result.body.items[0];
                    result.tid = TimeUuid.now().toString();
                    result.page_deleted = result.rev;
                    return P.join(
                        hyper.put({
                            uri: this.tableURI(rp.domain),
                            body: {
                                table: tableName,
                                attributes: Object.assign({}, result)
                            }
                        }),
                        // TODO: Object.assign here is to avoid a bug in sqlite
                        // backend that modifies original attribute.
                        this.storePageDeletion(hyper, req, Object.assign({}, result))
                    ).throw(e);
                }));
        } else {
            revisionRequest = titleRevisionRequest()
            .catch({ status: 404 }, () => this.fetchAndStoreMWRevision(hyper, req));
        }
        return revisionRequest
        .then((res) => {
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
     * @param {Object} item the revision item
     * @throws HTTPError if access to the revision should be denied
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
                rvprop: 'ids|timestamp|user|userid|size|sha1|contentmodel|comment|tags'
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
                const restrictions = Object.keys(apiRev).filter(key => /hidden$/.test(key));

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
            getTitleRevision: prs.getTitleRevision.bind(prs),
            getRestrictions: prs.getRestrictions.bind(prs),
            postRestrictions: prs.postRestrictions.bind(prs),
        },
        resources: [
            {
                // Revision table
                uri: `/{domain}/sys/table3/${tableName}`,
                body: prs.getTableSchema()
            },
            {
                uri: `/{domain}/sys/table3/${restrictionsTableName}`,
                body: prs.restrictionsTableSchema()
            }
        ]
    };
};
