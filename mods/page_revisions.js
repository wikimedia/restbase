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
            // Revision tags. Examples:
            // - revision deletion or suppression
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
        ]
    };
};


// /page/
PRS.prototype.listTitles = function(restbase, req, options) {
    // Forward to the revision bucket
    // XXX: instead forward to a page bucket?
    req.uri = req.uri.replace(/\/$/, '.rev/');
    req.body = {
        table: req.params.bucket + '.rev',
        proj: ['title'],
        distinct: true
    };
    return restbase.get(req)
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
            rvprop: 'ids|timestamp|user|userid|size|sha1|contentmodel|comment'
        }
    };
    if (/^[0-9]+$/.test(rp.revision)) {
        apiReq.body.revids = rp.revision;
    } else {
        apiReq.body.titles = rp.title;
    }
    return restbase.put(apiReq)
    .then(function(apiRes) {
        var apiRev = apiRes.body.items[0].revisions[0];
        var tid = rbUtil.tidFromDate(apiRev.timestamp);
        return restbase.put({ // Save / update the revision entry
            uri: self.tableURI(rp.domain),
            body: {
                table: self.tableName,
                attributes: {
                    title: rp.title,
                    rev: parseInt(apiRev.revid),
                    tid: tid,
                    user_id: apiRev.userid,
                    user_text: apiRev.user,
                    comment: apiRev.comment
                }
            }
        })
        .then(function() {
            rp.revision = apiRev.revid + '';
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

PRS.prototype.putFormatRevision = function(restbase, req) {
    var rp = req.params;
    // Check the local db
    var revTable = rp.bucket + '.' + rp.format;
    var beReq = {
        uri: '/v1/' + rp.domain + '/' + revTable + '/'
                    + rp.key + '/' + rp.revision,
        headers: req.headers,
        body: req.body
    };
    return restbase.put(beReq);
};

PRS.prototype.listItem = function(restbase, req) {
    return Promise.resolve({
        status: 200,
        body: {
            items: ['html','data-parsoid'],
            comment: 'TODO: update this dynamically from bucket metadata!'
        }
    });
};

PRS.prototype.listRevisions = function(restbase, req) {
    var rp = req.params;
    return restbase.get({
        uri: '/v1/' + rp.domain + '/' + rp.bucket + '.rev/' + rp.key + '/',
        body: {
            table: rp.bucket + '.rev',
            attributes: {
                title: rp.key
            },
            proj: ['tid']
        }
    })
    .then(function(res) {
        if (res.status === 200) {
            res.body.items = res.body.items.map(function(row) {
                return row.tid;
            });
        }
        return res;
    });
};

module.exports = function(options) {
    var prs = new PRS(options);
    // XXX: add docs
    return {
        spec: spec,
        operations: {
            //listTitleRevisions: PRS.listTitleRevisions.bind(prs),
            getTitleRevision: prs.getTitleRevision.bind(prs),
            //getTitleRevisionId: PRS.getTitleRevisionId.bind(prs)
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
