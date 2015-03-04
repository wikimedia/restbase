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

// TODO: move to module
var fs = require('fs');
var yaml = require('js-yaml');
var spec = yaml.safeLoad(fs.readFileSync(__dirname + '/page_revisions.yaml'));


// Store titles as MediaWiki db keys
function normalizeTitle (title) {
    return title.replace(/ /g, '_');
}


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
        attributes: {
            // listing: /titles.rev/Barack_Obama/master/
            // @specific time: /titles.rev/Barack_Obama?ts=20140312T20:22:33.3Z
            title: 'string',
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
            comment: 'string'
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
    return true;
};

// /page/
PRS.prototype.listTitles = function(restbase, req, options) {
    var rp = req.params;
    var listReq = {
        uri: this.tableURI(rp.domain),
        body: {
            table: this.tableName,
            proj: ['title','rev'],
            // Can't combine secondary index access with distinct
            //distinct: true,
            limit: 1000
        }
    };

    return restbase.get(listReq)
    .then(function(res) {
        // Hacky distinct implementation as workaround
        var items = [];
        var lastTitle;
        res.body.items.forEach(function(row) {
            if (row.title !== lastTitle) {
                items.push(row.title);
                lastTitle = row.title;
            }
        });
        res.body.items = items;
        return res;
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
            prop: 'revisions',
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
        var restrictions = Object.keys(apiRev).filter(function(key) { return /hidden$/.test(key); });
        // the tid to store this info under
        var tid = rbUtil.tidFromDate(apiRev.timestamp);
        return restbase.put({ // Save / update the revision entry
            uri: self.tableURI(rp.domain),
            body: {
                table: self.tableName,
                attributes: {
                    // FIXME: if a title has been given, check it
                    // matches the one returned by the MW API
                    // cf. https://phabricator.wikimedia.org/T87393
                    title: normalizeTitle(dataResp.title),
                    rev: parseInt(apiRev.revid),
                    tid: tid,
                    namespace: parseInt(dataResp.ns),
                    user_id: apiRev.userid,
                    user_text: apiRev.user,
                    comment: apiRev.comment,
                    tags: apiRev.tags,
                    restrictions: restrictions
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
        if(e.status === 500 && /^Missing query pages/.test(e.description)) {
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
                    title: normalizeTitle(rp.title),
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
    } else if (!rp.revision) {
        revisionRequest = self.fetchAndStoreMWRevision(restbase, req);
    } else {
        throw new Error("Invalid revision: " + rp.revision);
    }
    return revisionRequest
    .then(function(res) {
        // check if the revision has any restrictions
        self._checkRevReturn(res);
        if (!res.headers) {
            res.headers = {};
        }
        res.headers.etag = res.body.items[0].tid;
        return res;
    });
    // TODO: handle other revision formats (tid)
};

PRS.prototype.listTitleRevisions = function(restbase, req) {
    var rp = req.params;
    return restbase.get({
        uri: this.tableURI(rp.domain),
        body: {
            table: this.tableName,
            attributes: {
                title: normalizeTitle(rp.title)
            },
            proj: ['rev'],
            limit: 1000
        }
    })
    .then(function(res) {
        // Flatten to an array of revisions rather than an array of objects
        res.body.items = res.body.items.map(function(row) {
            return row.rev;
        });
        return res;
    });
};

// /rev/
PRS.prototype.listRevisions = function(restbase, req) {
    var rp = req.params;
    var listReq = {
        uri: this.tableURI(rp.domain),
        body: {
            table: this.tableName,
            index: 'by_rev',
            proj: ['rev','tid'],
            // Can't use distinct with secondary index
            // distinct: true,
            limit: 1000
        }
    };
    return restbase.get(listReq)
    .then(function(res) {
        // Hacky distinct implementation as workaround
        var items = [];
        var lastRev;
        res.body.items.forEach(function(row) {
            if (row.rev !== lastRev) {
                items.push(row.rev);
                lastRev = row.rev;
            }
        });
        res.body.items = items;
        return res;
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
