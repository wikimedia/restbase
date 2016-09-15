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

var HyperSwitch = require('hyperswitch');
var HTTPError = HyperSwitch.HTTPError;
var URI = HyperSwitch.URI;
var TimeUuid = require('cassandra-uuid').TimeUuid;
var mwUtil = require('../lib/mwUtil');
var stringify = require('json-stable-stringify');
var P = require('bluebird');

var spec = HyperSwitch.utils.loadSpec(__dirname + '/page_revisions.yaml');

// Title Revision Service
function PRS(options) {
    this.options = options;
}


PRS.prototype.tableName = 'title_revisions';
PRS.prototype.tableURI = function(domain) {
    return new URI([domain, 'sys', 'table', this.tableName, '']);
};

// Get the schema for the revision table
PRS.prototype.getTableSchema = function() {
    return {
        table: this.tableName,
        version: 4,
        attributes: {
            // Listing: /titles.rev/Barack_Obama/master/
            // @specific time: /titles.rev/Barack_Obama?ts=20140312T20:22:33.3Z
            title: 'string',
            page_id: 'int',
            rev: 'int',             // MediaWiki oldid
            latest_rev: 'int',      // Latest MediaWiki revision
            tid: 'timeuuid',
            namespace: 'int',       // The namespace ID of the page
            // revision deletion or suppression, can be:
            // - sha1hidden, commenthidden, texthidden
            restrictions: 'set<string>',
            // Revision tags. Examples:
            // - minor revision
            tags: 'set<string>',
            // Page renames. null, to:destination or from:source
            // Followed for linear history, possibly useful for branches / drafts
            renames: 'set<string>',
            nextrev_tid: 'timeuuid',// Tid of next revision, or null
            latest_tid: 'timeuuid', // Static, CAS synchronization point
            // Revision metadata in individual attributes for ease of indexing
            user_id: 'int',         // Stable for contributions etc
            user_text: 'string',
            timestamp: 'timestamp',
            comment: 'string',
            redirect: 'boolean',
            page_deleted: 'int'
        },
        index: [
            { attribute: 'title', type: 'hash' },
            { attribute: 'rev', type: 'range', order: 'desc' },
            { attribute: 'latest_rev', type: 'static' },
            { attribute: 'tid', type: 'range', order: 'desc' },
            { attribute: 'page_deleted', type: 'static' }
        ],
        secondaryIndexes: {
            by_rev: [
                { attribute: 'rev', type: 'hash' },
                { attribute: 'tid', type: 'range', order: 'desc' },
                { attribute: 'title', type: 'range', order: 'asc' },
                { attribute: 'restrictions', type: 'proj' }
            ]
        }
    };
};

/**
 * The name of the suppression table
 * @type {string}
 * @const
 */
PRS.prototype.restrictionsTableName = 'restrictions';

/**
 * Suppression table schema
 *
 * @type {Object}
 * @const
 */
PRS.prototype.restrictionsTableSchema = function() {
    return {
        table: this.tableName,
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
            { attribute: 'rev', type: 'range', order: 'asc' },
            { attribute: 'page_deleted', type: 'static' }
        ]
    };
};

/**
 * Returns the suppression table URI for a given domain
 * @param {string} domain the domain
 * @returns {URI} suppression table URI
 */
PRS.prototype.restrictionsTableURI = function(domain) {
    return new URI([domain, 'sys', 'table', this.restrictionsTableName, '']);
};

PRS.prototype.getRestrictions = function(hyper, req) {
    var self = this;
    var rp = req.params;
    var attributes = { title: rp.title };
    if (rp.revision) {
        attributes.rev = {
            ge: rp.revision
        };
    }
    return hyper.get({
        uri: self.restrictionsTableURI(rp.domain),
        body: {
            table: self.restrictionsTableName,
            attributes: attributes,
            limit: 1
        }
    })
    .then(function(res) {
        // Remove possible revision restrictions as here we just need
        // the page deletion info
        var restrictions = res.body && res.body.items && res.body.items[0] || null;
        if (restrictions) {
            if (restrictions.rev !== rp.revision && restrictions.restrictions) {
                restrictions.restrictions = [];
            }
            res.body = restrictions;
        } else {
            res.body = null;
        }
        return res;
    });
};

/**
 * Update restrictions for a title & revision. Used primarily by the parsoid
 * module to update redirects on save.
 */
PRS.prototype.postRestrictions = function(hyper, req) {
    var rp = req.params;
    // Validate the request body
    var body = req.body;
    if (!body || !(body.restrictions || body.redirect)) {
        throw new HTTPError({
            status: 400,
            body: {
                type: 'bad_request',
                description: 'Expected restrictions or redirect in the POST body.',
            }
        });
    }
    var revision = {
        title: rp.title,
        rev: rp.revision,
    };
    Object.assign(revision, body);
    return this.storeRestrictions(hyper, req, revision);
};

// Const TimeUuid to enable partial restriction updates.
var tidNode = new Buffer([0x01, 0x23, 0x45, 0x67, 0x89, 0xab]);
var tidClock = new Buffer([0x12, 0x34]);
var restrictionsTid = new TimeUuid(new Date(0), 0, tidNode, tidClock).toString();

PRS.prototype.storeRestrictions = function(hyper, req, revision) {
    var self = this;
    var rp = req.params;
    // Do not even define attributes we don't want to overwrite.
    var restrictionObject = {};
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
        var attributes = {
            title: revision.title,
            rev: revision.rev,
            // Always use the same tid to allow partial updates.
            _tid: restrictionsTid,
        };
        Object.assign(attributes, restrictionObject);
        return hyper.put({
            uri: self.restrictionsTableURI(rp.domain),
            body: {
                table: self.restrictionsTableName,
                attributes: attributes
            }
        });
    } else {
        // New restrictions are not specified. To avoid filling the
        // table with useless data first check whether there were
        // some restrictions stored before and overwrite only if needed
        return self.getRestrictions(hyper, {
            params: {
                domain: rp.domain,
                title: revision.title,
                rev: revision.rev
            }
        })
        .then(function(res) {
            var oldRestriction = res.body;
            if (oldRestriction.restrictions && oldRestriction.restrictions.length
                    || oldRestriction.page_deleted) {
                // There were restrictions before. Record absence of
                // restrictions.
                return hyper.put({
                    uri: self.restrictionsTableURI(rp.domain),
                    body: {
                        table: self.restrictionsTableName,
                        attributes: {
                            title: revision.title,
                            rev: revision.rev,
                            _tid: restrictionsTid,
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
};

PRS.prototype.storePageDeletion = function(hyper, req, revision) {
    return this.storeRestrictions(hyper, req, {
        title: req.params.title,
        rev: req.params.revision || revision.rev,
        page_deleted: revision.page_deleted
    });
};

/**
 * Checks the revision info returned from the storage/MW API
 * for restrictions, and if there are any, acts appropriately:
 *  - page_deleted: raise 404 error
 *  - sha1hidden or texthidden: raise 403 error
 *  - commenthidden: remove comment field from response
 *  - userhidden: remove user information from response
 *
 * @param item Object the revision item
 * @throws HTTPError if access to the revision should be denied
 */
PRS.prototype._checkRevReturn = function(item) {
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
};

// /page/
PRS.prototype.listTitles = function(hyper, req, options) {
    var rp = req.params;
    var listReq = {
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
    .then(function(res) {
        var pages = res.body.items;
        var items = [];

        Object.keys(pages).forEach(function(pageId) {
            var article = pages[pageId];
            items.push(article.title);
        });

        var next = {};
        if (res.body.next) {
            next = {
                next: {
                    href: "?page=" + mwUtil.encodePagingToken(hyper, res.body.next)
                }
            };
        }

        return {
            status: 200,
            body: {
                items: items,
                _links: next
            }
        };
    });
};

/**
 * Checks if two revisions are the same, ignoring different tid values.
 * @private
 */
PRS.prototype._checkSameRev = function(firstRev, secondRev) {
    function normalizeRev(rev) {
        var result = {};
        Object.keys(rev).forEach(function(key) {
            var value = rev[key];
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
    }
    return stringify(normalizeRev(firstRev)) === stringify(normalizeRev(secondRev));
};

PRS.prototype.fetchMWRevision = function(hyper, req) {
    var rp = req.params;
    // Try to resolve MW oldids to tids
    var apiReq = {
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
    .then(function(apiRes) {
        var items = apiRes.body.items;
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
        var dataResp = apiRes.body.items[0];

        // Re-normalize title returned by MW.
        // - Gendered namespaces converted to gender-neutral version
        // - Title text format with spaces converted to underscores
        // - Check whether it's still the same title to avoid non-needed
        //   normalizations like + => space
        return mwUtil.normalizeTitle(hyper, req, dataResp.title)
        .then(function(normTitle) {
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
            var apiRev = dataResp.revisions[0];
            // Are there any restrictions set?
            // FIXME: test for the precise attributes instead, this can easily
            // break if new keys are added.
            var restrictions = Object.keys(apiRev).filter(function(key) {
                return /hidden$/.test(key);
            });

            return {
                title: normTitle,
                page_id: parseInt(dataResp.pageid),
                rev: parseInt(apiRev.revid),
                tid: TimeUuid.now().toString(),
                namespace: parseInt(dataResp.ns),
                user_id: restrictions.indexOf('userhidden') < 0 ? apiRev.userid : null,
                user_text: restrictions.indexOf('userhidden') < 0 ? apiRev.user : null,
                timestamp: apiRev.timestamp,
                comment: restrictions.indexOf('commenthidden') < 0 ? apiRev.comment : null,
                tags: apiRev.tags,
                restrictions: restrictions,
                // Get the redirect property, it's inclusion means true
                // FIXME: Figure out redirect strategy: https://phabricator.wikimedia.org/T87393
                redirect: dataResp.redirect !== undefined
            };
        });
    });
};

PRS.prototype.fetchAndStoreMWRevision = function(hyper, req) {
    var self = this;
    var rp = req.params;
    return self.fetchMWRevision(hyper, req)
    .then(function(revision) {
        // Check if the same revision is already in storage
        return P.join(hyper.get({
                uri: self.tableURI(rp.domain),
                body: {
                    table: self.tableName,
                    attributes: {
                        title: revision.title,
                        rev: revision.rev
                    }
                }
            }),
            // TODO: Before we fill in the restrictions table we need
            // to store the restriction regardless of the revision change

            self.storeRestrictions(hyper, req, revision))
        .spread(function(res) {
            var sameRev = res && res.body.items
                    && res.body.items.length > 0
                    && self._checkSameRev(revision, res.body.items[0]);
            if (!sameRev) {
                throw new HTTPError({ status: 404 });
            }
        })
        .catch({ status: 404 }, function() {
            return hyper.put({ // Save / update the revision entry
                uri: self.tableURI(rp.domain),
                body: {
                    table: self.tableName,
                    attributes: revision
                }
            });
        })
        .then(function() {
            self._checkRevReturn(revision);
            // No restrictions, continue
            rp.revision = revision.rev + '';
            rp.title = revision.title;
            return self.getTitleRevision(hyper, req);
        });
    });
};


PRS.prototype.getTitleRevision = function(hyper, req) {
    var self = this;
    var rp = req.params;
    var revisionRequest;
    function getLatestTitleRevision() {
        return hyper.get({
            uri: self.tableURI(rp.domain),
            body: {
                table: self.tableName,
                attributes: {
                    title: rp.title
                },
                limit: 1
            }
        });
    }

    if (/^[0-9]+$/.test(rp.revision)) {
        // Check the local db
        revisionRequest = hyper.get({
            uri: this.tableURI(rp.domain),
            body: {
                table: this.tableName,
                attributes: {
                    title: rp.title,
                    rev: parseInt(rp.revision)
                },
                limit: 1
            }
        })
        .catch({ status: 404 }, function() {
            return self.fetchAndStoreMWRevision(hyper, req);
        });
    } else if (!rp.revision) {
        if (mwUtil.isNoCacheRequest(req)) {
            revisionRequest = self.fetchAndStoreMWRevision(hyper, req)
            .catch({ status: 404 }, function(e) {
                return getLatestTitleRevision()
                // In case 404 is returned by MW api, the page is deleted
                // TODO: Handle this directly with more targeted page
                // deletion/ un-deletion events.
                .then(function(result) {
                    result = result.body.items[0];
                    result.tid = TimeUuid.now().toString();
                    result.page_deleted = result.rev;
                    return P.join(hyper.put({
                            uri: self.tableURI(rp.domain),
                            body: {
                                table: self.tableName,
                                attributes: Object.assign({}, result)
                            }
                        }),
                        // TODO: Object.assign here is to avoid a bug in sqlite
                        // backend that modifies original attribute.
                        self.storePageDeletion(hyper, req, Object.assign({}, result))
                    ).throw(e);
                });
            });
        } else {
            revisionRequest = getLatestTitleRevision()
            .catch({ status: 404 }, function() {
                return self.fetchAndStoreMWRevision(hyper, req);
            });
        }
    } else {
        throw new Error("Invalid revision: " + rp.revision);
    }
    return revisionRequest
    .then(function(res) {
        // Check if the revision has any restrictions
        self._checkRevReturn(res.body.items.length && res.body.items[0]);

        // Clear paging info
        delete res.body.next;

        if (!res.headers) {
            res.headers = {};
        }
        var info = res.body.items[0];
        res.headers.etag = mwUtil.makeETag(info.rev, info.tid);
        return res;
    });
    // TODO: handle other revision formats (tid)
};

PRS.prototype.listTitleRevisions = function(hyper, req) {
    var rp = req.params;
    var revisionRequest = {
        table: this.tableName,
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
    .then(function(res) {
        // Flatten to an array of revisions rather than an array of objects &
        // perform some ghetto uniquification.
        var items = [];
        var lastRev;
        res.body.items.forEach(function(row) {
            if (lastRev !== row.rev) {
                items.push(row.rev);
                lastRev = row.rev;
            }
        });
        if (res.body.next) {
            res.body._links = {
                next: {
                    href: "?page=" + mwUtil.encodePagingToken(hyper, res.body.next)
                }
            };
        }
        res.body.items = items;
        return res;
    });
};

// /rev/
PRS.prototype.listRevisions = function(hyper, req) {
    var rp = req.params;

    var listReq = {
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
    .then(function(res) {
        var pages = res.body.items;
        var items = [];
        Object.keys(pages).forEach(function(pageId) {
            var article = pages[pageId];
            items.push(article.revisions[0].revid);
        });
        var next = {};
        if (res.body.next) {
            next = {
                next: {
                    href: "?page=" + mwUtil.encodePagingToken(hyper, res.body.next)
                }
            };
        }

        return {
            status: 200,
            body: {
                items: items,
                _links: next
            }
        };
    });
};

PRS.prototype.getRevision = function(hyper, req) {
    var rp = req.params;
    var self = this;
    // Sanity check
    if (!/^[0-9]+$/.test(rp.revision)) {
        throw new HTTPError({
            status: 400,
            body: {
                type: 'bad_request#invalid_revision',
                description: 'Invalid revision specified',
                rev: rp.revision
            }
        });
    }
    if (mwUtil.isNoCacheRequest(req)) {
        // Ask the MW API directly and
        // store and return its result
        return this.fetchAndStoreMWRevision(hyper, req);
    }
    // Check the storage, and, if no match is found
    // ask the MW API about the revision
    return hyper.get({
        uri: this.tableURI(rp.domain),
        body: {
            table: this.tableName,
            index: 'by_rev',
            attributes: {
                rev: parseInt(rp.revision)
            },
            limit: 1
        }
    })
    .then(function(res) {
        // Check the return
        self._checkRevReturn(res.body.items.length && res.body.items[0]);

        // Clear paging info
        delete res.body.next;

        // And get the revision info for the
        // page now that we have the title
        rp.title = res.body.items[0].title;
        return self.getTitleRevision(hyper, req);
    })
    .catch({ status: 404 }, function() {
        return self.fetchAndStoreMWRevision(hyper, req);
    });
};

module.exports = function(options) {
    var prs = new PRS(options);
    // XXX: add docs
    return {
        spec: spec,
        operations: {
            listTitles: prs.listTitles.bind(prs),
            listTitleRevisions: prs.listTitleRevisions.bind(prs),
            getTitleRevision: prs.getTitleRevision.bind(prs),
            listRevisions: prs.listRevisions.bind(prs),
            getRevision: prs.getRevision.bind(prs),
            getRestrictions: prs.getRestrictions.bind(prs),
            postRestrictions: prs.postRestrictions.bind(prs),
        },
        resources: [
            {
                // Revision table
                uri: '/{domain}/sys/table/' + prs.tableName,
                body: prs.getTableSchema()
            },
            {
                uri: '/{domain}/sys/table/' + prs.restrictionsTableName,
                body: prs.restrictionsTableSchema()
            }
        ]
    };
};
