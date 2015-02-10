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
            // revision deletion or suppression, can be:
            // - sha1hidden, commenthidden, texthidden
            hidden: 'set<string>',
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
                { attribute: 'hidden', type: 'proj' },
                { attribute: 'tags', type: 'proj' }
            ]
        }
    };
};


// /page/
PRS.prototype.listTitles = function(restbase, req, options) {
    var rp = req.params;
    var listReq = {
        uri: this.tableURI(rp.domain),
        body: {
            table: this.tableName,
            proj: ['title'],
            distinct: true
        }
    };

    return restbase.get(listReq)
    .then(function(res) {
        if (res.status === 200) {
            res.body.items = res.body.items.map(function(row) {
                return row.title;
            });
        }
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
        // are there any hidden fields set?
        var hidden = Object.keys(apiRev).filter(function(key) { return /hidden$/.test(key) });
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
                    title: dataResp.title,
                    rev: parseInt(apiRev.revid),
                    tid: tid,
                    user_id: apiRev.userid,
                    user_text: apiRev.user,
                    comment: apiRev.comment,
                    tags: apiRev.tags,
                    hidden: hidden
                }
            }
        })
        .then(function() {
            rp.revision = apiRev.revid + '';
            rp.title = dataResp.title;
            return self.getTitleRevision(restbase, req);
        });
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
                    title: rp.title,
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
    } else if (rp.revision === 'latest') {
        revisionRequest = self.fetchAndStoreMWRevision(restbase, req);
    } else {
        throw new Error("Invalid revision: " + rp.revision);
    }
    return revisionRequest
    .then(function(res) {
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
                title: rp.title
            },
            proj: ['rev']
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

PRS.prototype.getRevision = function(restbase, req) {
    var rp = req.params;
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
    // TODO TODO TODO
    // Currently, we cannot query Cassandra without specifying
    // relevant fields in the primary key, which is what we nned
    // to do in this case (as we do not have a title, but only a
    // revision id). Therefore, until this issue is resolved, we
    // have to ask the MW API directly about the revision info and
    // store it before giving it to the user, even if we have that
    // info stored already.
    return this.fetchAndStoreMWRevision(restbase, req);
    // END TODO END
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
            attributes: {
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
            getRevision: prs.getRevision.bind(prs),
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
