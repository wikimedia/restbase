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


var rbUtil = require('../lib/rbUtil.js');
var URI = require('swagger-router').URI;
var uuid = require('cassandra-uuid').TimeUuid;
var P = require('bluebird');

// TODO: move to module
var fs = require('fs');
var yaml = require('js-yaml');
var spec = yaml.safeLoad(fs.readFileSync(__dirname + '/page_revisions.yaml'));


// Title Revision Service
function PRS(options) {
    this.options = options;
    this.log = options.log || function() {};
}


PRS.prototype.tableName = 'title_revisions';
PRS.prototype.tableURI = function(domain) {
    return new URI([domain, 'sys', 'table', this.tableName, '']);
};

// Get the schema for the revision table
PRS.prototype.getTableSchema = function() {
    return {
        table: this.tableName,
        version: 3,
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
            redirect: 'boolean'
        },
        index: [
            { attribute: 'title', type: 'hash' },
            { attribute: 'rev', type: 'range', order: 'desc' },
            { attribute: 'latest_rev', type: 'static' },
            { attribute: 'tid', type: 'range', order: 'desc' }
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

PRS.prototype.pageTableName = 'page';
PRS.prototype.pageTableURI = function(domain) {
    return new URI([domain, 'sys', 'table', this.pageTableName, '']);
};
PRS.prototype.getPageTableSchema = function() {
    return {
        table: this.pageTableName,
        version: 1,
        attributes: {
            title: 'string',
            event_type: 'string', // Enum: 'rename_to', 'rename_from', 'delete', 'undelete'
            event_data: 'string',
            good_after: 'timeuuid',
            tid: 'timeuuid'
        },
        index: [
            { attribute: 'title', type: 'hash' },
            { attribute: 'good_after', type: 'static' },
            { attribute: 'tid', type: 'range', order: 'desc' }
        ]
    };
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
 * @return true
 * @throws rbUtil.httpError if access to the revision should be denied
 */
PRS.prototype._checkRevReturn = function(item) {
    if (item && Array.isArray(item.restrictions) && item.restrictions.length > 0) {
        // Page was deleted
        if (item.restrictions.indexOf('page_deleted') >= 0) {
            throw new rbUtil.HTTPError({
                status: 404,
                body: {
                    type: 'not_found#page_revisions',
                    description: 'Page was deleted'
                }
            });
        }
        // Revision restricted
        if (item.restrictions.indexOf('sha1hidden') >= 0
                || item.restrictions.indexOf('texthidden') >= 0) {
            throw new rbUtil.HTTPError({
                status: 403,
                body: {
                    type: 'access_denied#revision',
                    title: 'Access to resource denied',
                    description: 'Access is restricted for revision ' + item.rev,
                    restrictions: item.restrictions
                }
            });
        }
        // Check if user/comment data should be removed from response
        if (item.restrictions.indexOf('userhidden') >= 0) {
            delete item.user_id;
            delete item.user_text;
        }
        if (item.restrictions.indexOf('commenthidden') >= 0) {
            delete item.comment;
        }
    }
    return true;
};

PRS.prototype._signalPageDeleted = function(restbase, req) {
    var self = this;
    var rp = req.params;
    var now = uuid.now().toString();
    return restbase.put({
        uri: self.pageTableURI(rp.domain),
        body: {
            table: self.pageTableName,
            attributes: {
                title: rbUtil.normalizeTitle(rp.title),
                tid: now,
                event_type: 'delete',
                good_after: now
            }
        }
    });
};

PRS.prototype._checkPageUndeleted = function(restbase, req, res) {
    var self = this;
    var pageData = res.pageData;
    var rp = req.params;

    function findDeleteEvent() {
        var prevDeletedEvent;
        for (var idx = 0; idx < pageData.body.items.length; idx ++) {
            var event = pageData.body.items[idx];
            if (event.event_type === 'delete') {
                if (prevDeletedEvent) {
                    return event;
                }
                prevDeletedEvent = event;
            }
        }
    }

    if (pageData
            && pageData.body.items
            && pageData.body.items.length
            && res.pageData.body.items[0].event_type === 'delete') {
        var prevDeletedEvent = findDeleteEvent();
        var newGoodAfter = prevDeletedEvent && prevDeletedEvent.tid || null;
        return restbase.put({
            uri: self.pageTableURI(rp.domain),
            body: {
                table: self.pageTableName,
                attributes: {
                    title: rbUtil.normalizeTitle(rp.title),
                    tid: uuid.now().toString(),
                    event_type: 'undelete',
                    good_after: newGoodAfter
                }
            }
        })
        .then(function() { return res; });
    } else {
        return P.resolve(res);
    }
};

PRS.prototype._checkPageDeletion = function(restbase, req, res) {
    var revInfo = res.revisionInfo;
    var pageData = res.pageData;
    var item = revInfo.body.items.length && revInfo.body.items[0];
    var latestPageEvent = pageData && pageData.body.items;
    if (item && latestPageEvent && latestPageEvent.length) {
        var deleteTid = pageData.body.items[0].good_after;
        if (deleteTid && uuid.fromString(deleteTid).getDate()
                >= uuid.fromString(item.tid).getDate()) {
            throw new rbUtil.HTTPError({
                status: 404,
                body: {
                    type: 'not_found#page_revisions',
                    description: 'Page was deleted'
                }
            });
        }
    }
};

// /page/
PRS.prototype.listTitles = function(restbase, req, options) {
    var rp = req.params;
    var listReq = {
        uri: new URI([rp.domain, 'sys', 'action', 'query']),
        method: 'post',
        body: {
            generator: 'allpages',
            gaplimit: restbase.rb_config.default_page_size,
            prop: 'revisions',
            format: 'json'
        }
    };

    if (req.query.page) {
        Object.assign(listReq.body, restbase.decodeToken(req.query.page));
    }

    return restbase.get(listReq)
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
                    href: "?page=" + restbase.encodeToken(res.body.next)
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
    return !Object.keys(firstRev).some(function(attrName) {
        var firstVal = firstRev[attrName];
        var secondVal = secondRev[attrName];
        // We don't really care if an empty value is null, or undefined, or other falsy
        if (!firstVal || !secondVal || attrName === 'tid') {
            return false;
        } else if (attrName === 'timestamp') {
            // 'timestamp' fields need to be parsed because Cassandra
            // returns a ISO8601 ts which includes milliseconds, while
            // the ts returned by MW API does not
            return Date.parse(firstVal) !== Date.parse(secondVal);
        } else if (Array.isArray(firstVal) || Array.isArray(secondVal)) {
            // we need a special case for arrays (the 'restrictions' attribute)
            if (Array.isArray(firstVal) && Array.isArray(secondVal)
                    && firstVal.length === secondVal.length) {
                for (var idx = 0; idx < firstVal.length; idx++) {
                    if (firstVal[idx] !== secondVal[idx]) {
                        return true;
                    }
                }
                return false;
            }
            return true;
        }
        return firstVal !== secondVal;
    });
};

PRS.prototype.fetchAndStoreMWRevision = function(restbase, req) {
    var self = this;
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
    return restbase.post(apiReq)
    .then(function(apiRes) {
        var items = apiRes.body.items;
        if (!items.length || !items[0].revisions) {
            throw new rbUtil.HTTPError({
                status: 404,
                body: {
                    type: 'not_found#page_revisions',
                    description: 'Page or revision not found.',
                    apiResponse: apiRes
                }
            });
        }
        // The response item
        var dataResp = apiRes.body.items[0];
        // The revision info
        var apiRev = dataResp.revisions[0];
        // Are there any restrictions set?
        // FIXME: test for the precise attributes instead, this can easily
        // break if new keys are added.
        var restrictions = Object.keys(apiRev).filter(function(key) {
            return /hidden$/.test(key);
        });

        // Get the redirect property, it's inclusion means true
        var redirect = dataResp.redirect !== undefined;
        var revision = {
            // FIXME: if a title has been given, check it
            // matches the one returned by the MW API
            // cf. https://phabricator.wikimedia.org/T87393
            title: rbUtil.normalizeTitle(dataResp.title),
            page_id: parseInt(dataResp.pageid),
            rev: parseInt(apiRev.revid),
            tid: uuid.now().toString(),
            namespace: parseInt(dataResp.ns),
            user_id: restrictions.indexOf('userhidden') < 0 ? apiRev.userid : null,
            user_text: restrictions.indexOf('userhidden') < 0 ? apiRev.user : null,
            timestamp: apiRev.timestamp,
            comment: restrictions.indexOf('commenthidden') < 0 ? apiRev.comment : null,
            tags: apiRev.tags,
            restrictions: restrictions,
            redirect: redirect
        };

        var actions = [
            // Check if the same revision is already in storage
            restbase.get({
                uri: self.tableURI(rp.domain),
                body: {
                    table: self.tableName,
                    attributes: {
                        title: rbUtil.normalizeTitle(dataResp.title),
                        rev: parseInt(apiRev.revid)
                    }
                }
            })
            .then(function(res) {
                var sameRev = res && res.body.items
                        && res.body.items.length > 0
                        && self._checkSameRev(revision, res.body.items[0]);
                if (!sameRev) {
                    throw new rbUtil.HTTPError({ status: 404 });
                }
            })
            .catch(function(e) {
                if (e.status === 404) {
                    return restbase.put({ // Save / update the revision entry
                        uri: self.tableURI(rp.domain),
                        body: {
                            table: self.tableName,
                            attributes: revision
                        }
                    });
                } else {
                    throw e;
                }
            })
        ];
        // Also check if the page title was changed and set a log rename history
        var parentTitle = req.headers['x-restbase-parenttitle'];
        if (parentTitle && parentTitle !== revision.title) {
            actions = actions.concat(self._storeRename(restbase, req, revision.title, parentTitle));
        }

        return P.all(actions)
        .then(function() {
            self._checkRevReturn(revision);
            // No restrictions, continue
            rp.revision = apiRev.revid + '';
            rp.title = dataResp.title;
            return self.getTitleRevision(restbase, req);
        });
    }).catch(function(e) {
        // If a bad revision is supplied, the action module
        // returns a 500 with the 'Missing query pages' message
        // so catch that and turn it into a 404 in our case
        if (e.status === 500 && /^Missing query pages/.test(e.body.description)) {
            throw new rbUtil.HTTPError({
                status: 404,
                body: {
                    type: 'not_found#page_revisions',
                    description: 'Page or revision not found.',
                    apiRequest: apiReq
                }
            });
        }
        throw e;
    });
};


PRS.prototype.getTitleRevision = function(restbase, req) {
    var self = this;
    var rp = req.params;
    var title = rbUtil.normalizeTitle(rp.title);
    var revisionRequest;
    var pageDataRequest = restbase.get({
        uri: self.pageTableURI(rp.domain),
        body: {
            table: self.pageTableName,
            attributes: {
                title: title
            }
        }
    })
    .catch(function(e) {
        // Ignore lack of page data
        if (e.status !== 404) {
            throw e;
        }
    }).then(function(res) {
        return res;
    });

    function getLatestTitleRevision() {
        return restbase.get({
            uri: self.tableURI(rp.domain),
            body: {
                table: self.tableName,
                attributes: {
                    title: title
                },
                limit: 1
            }
        });
    }

    if (/^[0-9]+$/.test(rp.revision)) {
        // Check the local db
        revisionRequest = P.props({
            revisionInfo: restbase.get({
                uri: this.tableURI(rp.domain),
                body: {
                    table: this.tableName,
                    attributes: {
                        title: title,
                        rev: parseInt(rp.revision)
                    },
                    limit: 1
                }
            })
            .catch(function(e) {
                if (e.status !== 404) {
                    throw e;
                }
                return self.fetchAndStoreMWRevision(restbase, req);
            }),
            pageData: pageDataRequest
        });
    } else if (!rp.revision) {
        if (req.headers && /no-cache/.test(req.headers['cache-control'])) {
            revisionRequest = P.props({
                revisionInfo: self.fetchAndStoreMWRevision(restbase, req),
                pageData: pageDataRequest
            })
            .then(function(res) {
                return self._checkPageUndeleted(restbase, req, res);
            })
            .catch(function(e) {
                if (e.status !== 404) {
                    throw e;
                }
                // Page data request never returns 404, so it's from MW API => page was deleted
                return self._signalPageDeleted(restbase, req)
                .then(function() {
                    throw e;
                });
            });
        } else {
            revisionRequest = P.props({
                revisionInfo: getLatestTitleRevision()
                .catch(function(e) {
                    if (e.status !== 404) {
                        throw e;
                    }
                    return self.fetchAndStoreMWRevision(restbase, req);
                }),
                pageData: pageDataRequest
            });
        }
        revisionRequest = revisionRequest.then(self._createRenameChecker(restbase, req));
    } else {
        throw new Error("Invalid revision: " + rp.revision);
    }
    return revisionRequest
    .then(function(res) {
        self._checkPageDeletion(restbase, req, res);
        res = res.revisionInfo;
        // Check if the revision has any restrictions
        self._checkRevReturn(res.body.items.length
                && res.body.items[0]);
        // Clear paging info
        delete res.body.next;

        if (!res.headers) {
            res.headers = {};
        }
        var info = res.body.items[0];
        res.headers.etag = rbUtil.makeETag(info.rev, info.tid);
        return res;
    });
    // TODO: handle other revision formats (tid)
};

PRS.prototype._createRenameChecker = function(restbase, req) {
    var self = this;
    var rp = req.params;
    return function(res) {
        if (res.pageData
                && res.pageData.body.items
                && res.pageData.body.items.length) {
            var latestEvent = res.pageData.body.items[0];
            var latestRev = res.revisionInfo.body.items[0];
            if (latestEvent.event_type === 'rename_to'
                    && uuid.fromString(latestEvent.tid).getDate()
                        >= uuid.fromString(latestRev.tid).getDate()) {
                return self._getLatestPageTitle(restbase, req, latestEvent)
                .then(function(latestTitle) {
                    var rootPath = restbase._rootReq.uri.path;
                    var newPath = [];
                    var titleSeen = false;
                    rootPath.forEach(function(pathElement) {
                        if (pathElement !== rp.title) {
                            if (titleSeen) {
                                newPath.push(pathElement);
                                newPath = ['..'].concat(newPath);
                            }
                        } else {
                            newPath.push(encodeURIComponent(latestTitle));
                            titleSeen = true;
                        }
                    });
                    throw new rbUtil.HTTPRedirect({
                        status: 301,
                        headers: {
                            location: newPath.join('/')
                        }
                    });
                });
            }
        }
        return res;
    };
};

PRS.prototype._getLatestPageTitle = function(restbase, req, renameEvent) {
    var self = this;
    var rp = req.params;
    return restbase.get({
        uri: self.pageTableURI(rp.domain),
        body: {
            table: self.pageTableName,
            attributes: {
                title: renameEvent.event_data,
                tid: {
                    ge: renameEvent.tid
                }
            },
            order: {
                tid: 'asc'
            }

        }
    })
    .then(function(res) {
        for (var idx = 0; idx < res.body.items.length; idx++) {
            var event = res.body.items[idx];
            // Page was deleted and no matching 'undelete' happened after
            if (event.event_type === 'delete'
                    && event.tid === event.good_after) {
                break;
            } else if (event.event_type === 'rename_to') {
                return self._getLatestPageTitle(restbase, req, event);
            }
        }
        // There always will be one, at least 'rename_from'
        return res.body.items[0].title;
    });
};

PRS.prototype._storeRename = function(restbase, req, currentTitle, parentTitle) {
    var self = this;
    var rp = req.params;
    var now = uuid.now().toString();
    return [
        {
            title: parentTitle,
            tid: now,
            event_type: 'rename_to',
            event_data: currentTitle
        },
        {
            title: currentTitle,
            tid: now,
            event_type: 'rename_from',
            event_data: parentTitle
        }
    ].map(function(item) {
        return restbase.put({
            uri: self.pageTableURI(rp.domain),
            body: {
                table: self.pageTableName,
                attributes: item
            }
        });
    });
};

PRS.prototype.listTitleRevisions = function(restbase, req) {
    var rp = req.params;
    var revisionRequest = {
        table: this.tableName,
        attributes: {
            title: rbUtil.normalizeTitle(rp.title)
        },
        proj: ['rev'],
        limit: restbase.rb_config.default_page_size
    };
    if (req.query.page) {
        revisionRequest.next = restbase.decodeToken(req.query.page);
    }
    return restbase.get({
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
                    href: "?page=" + restbase.encodeToken(res.body.next)
                }
            };
        }
        res.body.items = items;
        return res;
    });
};

// /rev/
PRS.prototype.listRevisions = function(restbase, req) {
    var rp = req.params;

    var listReq = {
        uri: new URI([rp.domain, 'sys', 'action', 'query']),
        method: 'post',
        body: {
            generator: 'allpages',
            gaplimit: restbase.rb_config.default_page_size,
            prop: 'revisions',
            format: 'json'
        }
    };
    if (req.query.page) {
        Object.assign(listReq.body, restbase.decodeToken(req.query.page));
    }
    return restbase.get(listReq)
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
                    href: "?page=" + restbase.encodeToken(res.body.next)
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

PRS.prototype.getRevision = function(restbase, req) {
    var rp = req.params;
    var self = this;
    // Sanity check
    if (!/^[0-9]+$/.test(rp.revision)) {
        throw new rbUtil.HTTPError({
            status: 400,
            body: {
                type: 'invalidRevision',
                description: 'Invalid revision specified.'
            }
        });
    }
    if (req.headers && /no-cache/.test(req.headers['cache-control'])) {
        // Ask the MW API directly and
        // store and return its result
        return this.fetchAndStoreMWRevision(restbase, req);
    }
    // Check the storage, and, if no match is found
    // ask the MW API about the revision
    return restbase.get({
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
        return self.getTitleRevision(restbase, req);
    })
    .catch(function(e) {
        if (e.status !== 404 || /^Page was deleted/.test(e.body.description)) {
            throw e;
        }
        return self.fetchAndStoreMWRevision(restbase, req);
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
            getRevision: prs.getRevision.bind(prs)
        },
        resources: [
            {
                // Revision table
                uri: '/{domain}/sys/table/' + prs.tableName,
                body: prs.getTableSchema()
            },
            {
                uri: '/{domain}/sys/table/' + prs.pageTableName,
                body: prs.getPageTableSchema()
            }
        ]
    };
};
