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

// TODO: move to module
var fs = require('fs');
var yaml = require('js-yaml');
var spec = yaml.safeLoad(fs.readFileSync(__dirname + '/page_revisions.yaml'));


// Title Revision Service
function PRS (options) {
    this.options = options;
    this.log = options.log || function(){};
}


PRS.prototype.tableName = 'title_revisions';
PRS.prototype.tableURI = function(domain) {
    return new URI([domain,'sys','table',this.tableName,'']);
};

// Get the schema for the revision table
PRS.prototype.getTableSchema = function () {
    return {
        table: this.tableName,
        version: 2,
        attributes: {
            // listing: /titles.rev/Barack_Obama/master/
            // @specific time: /titles.rev/Barack_Obama?ts=20140312T20:22:33.3Z
            title: 'string',
            page_id: 'int',
            rev: 'int',             // MediaWiki oldid
            latest_rev: 'int',      // Latest MediaWiki revision
            tid: 'timeuuid',
            namespace: 'int',       // the namespace ID of the page
            // revision deletion or suppression, can be:
            // - sha1hidden, commenthidden, texthidden
            restrictions: 'set<string>',
            // Revision tags. Examples:
            // - minor revision
            tags: 'set<string>',
            // Page renames. null, to:destination or from:source
            // Followed for linear history, possibly useful for branches / drafts
            renames: 'set<string>',
            nextrev_tid: 'timeuuid',// tid of next revision, or null
            latest_tid: 'timeuuid', // static, CAS synchronization point
            // revision metadata in individual attributes for ease of indexing
            user_id: 'int',         // stable for contributions etc
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
            ],
            by_ns: [
                { attribute: 'namespace', type: 'hash' },
                { attribute: 'title', type: 'range', order: 'asc' },
                { attribute: 'rev', type: 'range', order: 'desc' },
                { attribute: 'tid', type: 'range', order: 'desc' }
            ]
        }
    };
};

/**
 * Checks the revision info returned from the storage
 * for restrictions, and if there are any, raises an error
 *
 * @param res Object the result as returned from storage
 * @return true
 * @throws rbUtil.httpError if access to the revision should be denied
 */
PRS.prototype._checkRevReturn = function(res) {
    var item = res.body.items.length && res.body.items[0];
    // if there are any restrictions imposed on this
    // revision, forbid its retrieval, cf.
    // https://phabricator.wikimedia.org/T76165#1030962
    if (item && Array.isArray(item.restrictions) && item.restrictions.length > 0) {
        // there are some restrictions, deny access to the revision
        if (item.restrictions.indexOf('page_deleted') >= 0) {
            throw new rbUtil.HTTPError({
                status: 404,
                body: {
                    type: 'not_found#page_revisions',
                    description: 'Page was deleted'
                }
            });
        } else {
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
    }
    return true;
};

// /page/
PRS.prototype.listTitles = function(restbase, req, options) {
    var rp = req.params;
    var listReq = {
        uri: new URI([rp.domain,'sys','action','query']),
        method: 'post',
        body: {
            generator: 'allpages',
            gaplimit: restbase.rb_config.default_page_size,
            prop: 'revisions',
            format: 'json',
            gapcontinue: ''
        }
    };

    if (req.query.page) {
        listReq.body.gapcontinue = restbase.decodeToken(req.query.page);
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
                next: { "href": "?page="+restbase.encodeToken(res.body.next.allpages.gapcontinue) } 
            };
        }

        return {
            status: 200,
            body : {
                items: items,
                _links: next
            }
        };
    });
};

PRS.prototype.fetchAndStoreMWRevision = function (restbase, req) {
    var self = this;
    var rp = req.params;
    // Try to resolve MW oldids to tids
    var apiReq = {
        uri: new URI([rp.domain,'sys','action','query']),
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
        // the response item
        var dataResp = apiRes.body.items[0];
        // the revision info
        var apiRev = dataResp.revisions[0];
        // are there any restrictions set?
        // FIXME: test for the precise attributes instead, this can easily
        // break if new keys are added.
        var restrictions = Object.keys(apiRev).filter(function(key) {
            return /hidden$/.test(key);
        });

        //get the redirect property, it's inclusion means true
        var redirect = dataResp.redirect !== undefined;

        return restbase.put({ // Save / update the revision entry
            uri: self.tableURI(rp.domain),
            body: {
                table: self.tableName,
                attributes: {
                    // FIXME: if a title has been given, check it
                    // matches the one returned by the MW API
                    // cf. https://phabricator.wikimedia.org/T87393
                    title: rbUtil.normalizeTitle(dataResp.title),
                    page_id: parseInt(dataResp.pageid),
                    rev: parseInt(apiRev.revid),
                    tid: uuid.now().toString(),
                    namespace: parseInt(dataResp.ns),
                    user_id: apiRev.userid,
                    user_text: apiRev.user,
                    timestamp: apiRev.timestamp,
                    comment: apiRev.comment,
                    tags: apiRev.tags,
                    restrictions: restrictions,
                    redirect: redirect
                }
            }
        })
        .then(function() {
            // if there are any restrictions imposed on this
            // revision, forbid its retrieval, cf.
            // https://phabricator.wikimedia.org/T76165#1030962
            if (restrictions && restrictions.length > 0) {
                throw new rbUtil.HTTPError({
                    status: 403,
                    body: {
                        type: 'access_denied#revision',
                        title: 'Access to resource denied',
                        description: 'Access is restricted for revision ' + apiRev.revid,
                        restrictions: restrictions
                    }
                });
            }
            // no restrictions, continue
            rp.revision = apiRev.revid + '';
            rp.title = dataResp.title;
            return self.getTitleRevision(restbase, req);
        });
    }).catch(function(e) {
        // if a bad revision is supplied, the action module
        // returns a 500 with the 'Missing query pages' message
        // so catch that and turn it into a 404 in our case
        if(e.status === 500 && /^Missing query pages/.test(e.body.description)) {
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
    var revisionRequest;
    if (/^[0-9]+$/.test(rp.revision)) {
        // Check the local db
        revisionRequest = restbase.get({
            uri: this.tableURI(rp.domain),
            body: {
                table: this.tableName,
                attributes: {
                    title: rbUtil.normalizeTitle(rp.title),
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
        });
    } else if (!rp.revision || rp.revision === 'latest') {
        revisionRequest = self.fetchAndStoreMWRevision(restbase, req)
            .catch(function (e) {
                if (e.status !== 404) {
                    throw e;
                }
                // In case 404 is returned by MW api, the page is deleted
                return self.listTitleRevisions(restbase, req)
                    .then(function (res) {
                        if (res.body.items && res.body.items.length > 0 ) {
                            var revReq = {
                                uri: new URI([rp.domain, 'sys', 'page_revisions', 'rev', res.body.items[0]]),
                                params: {
                                    api: 'sys',
                                    domain: rp.domain,
                                    module: 'page_revisions',
                                    revision: res.body.items[0]
                                }
                            };
                            return self.getRevision(restbase, revReq);
                        } else {
                            throw e;
                        }
                    })
                    .then(function(result) {
                        result = result.body.items[0];
                        result.tid = uuid.now().toString();
                        result.restrictions = result.restrictions || [];
                        result.restrictions.push('page_deleted');
                        return restbase.put({
                            uri: self.tableURI(rp.domain),
                            body: {
                                table: self.tableName,
                                attributes: result
                            }
                        }).then(function () {
                            throw e;
                        });
                    });
            });
    } else {
        throw new Error("Invalid revision: " + rp.revision);
    }
    return revisionRequest
    .then(function(res) {
        // check if the revision has any restrictions
        self._checkRevReturn(res);

        // clear paging info
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
                next: { "href": "?page="+restbase.encodeToken(res.body.next) } 
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
        uri: new URI([rp.domain,'sys','action','query']),
        method: 'post',
        body: {
            generator: 'allpages',
            gaplimit: restbase.rb_config.default_page_size,
            prop: 'revisions',
            format: 'json',
            gapcontinue: ''
        }
    };
    if (req.query.page) {
        listReq.body.gapcontinue = restbase.decodeToken(req.query.page);
    }
    return restbase.get(listReq)
    .then(function(res) {
        var pages = res.body.items;
        var items = [];
        Object.keys(pages).forEach(function(pageId) {
            var article = pages[pageId];
            items.push(article.revisions[0].revid);
        });
        var next={};
        if (res.body.next) {
            next = { 
                next: { "href": "?page="+restbase.encodeToken(res.body.next.allpages.gapcontinue) } 
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
    // sanity check
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
        // ask the MW API directly and
        // store and return its result
        return this.fetchAndStoreMWRevision(restbase, req);
    }
    // check the storage, and, if no match is found
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
        // check the return
        self._checkRevReturn(res);

        // clear paging info
        delete res.body.next;

        // and get the revision info for the
        // page now that we have the title
        rp.title = res.body.items[0].title;
        return self.getTitleRevision(restbase, req);
    })
    .catch(function(e) {
        if (e.status !== 404) {
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
            //getTitleRevisionId: prs.getTitleRevisionId.bind(prs)
            listRevisions: prs.listRevisions.bind(prs),
            getRevision: prs.getRevision.bind(prs)
        },
        resources: [
            {
                // Revision table
                uri: '/{domain}/sys/table/' + prs.tableName,
                body: prs.getTableSchema()
            }
        ]
    };
};
