"use strict";

/**
 * Page content bucket handler
 */

/*
 * - creation: pages.rev, pages.{html,wikitext,data-parsoid}
 * - renaming? - would have to rename all sub-buckets
 */

var RouteSwitch = require('routeswitch');
var uuid = require('node-uuid');
var rbUtil = require('../../util.js');

var backend;
var config;

function PCBucket (options) {
    this.log = options.log || function(){};
}

PCBucket.prototype.getBucketInfo = function(restbase, req, options) {
    var self = this;
    return Promise.resolve({
        status: 200,
        body: options
    });
};

// Get the schema for the revision table
function getRevSchema () {
    return {
        table: 'pages.rev', // updated by caller
        attributes: {
            // listing: /pages.rev/Barack_Obama/master/
            // @specific time: /pages.rev/Barack_Obama?ts=20140312T20:22:33.3Z
            page: 'string',
            tid: 'timeuuid',
            // Page (or revision) was deleted
            // Set on an otherwise null entry on page deletion
            // XXX: move deleted revisions to a separate table?
            deleted: 'boolean',
            // Page renames. null, to:destination or from:source
            // Followed for linear history, possibly useful for branches / drafts
            renames: 'set<string>',
            rev: 'varint',          // MediaWiki oldid
            latest_tid: 'timeuuid', // static, CAS synchronization point
            // revision metadata in individual attributes for ease of indexing
            user_id: 'varint',      // stable for contributions etc
            user_text: 'string',
            comment: 'string',
            is_minor: 'boolean'
        },
        index: {
            hash: ['page'],
            range: ['tid'],
            order: ['desc'],
            static: ['latest_tid']
        },
        secondaryIndexes: {
            // /pages.rev//page/Foo/12345
            // @specific time: /pages.history//rev/12345?ts=20140312T20:22:33.3Z
            rev: {
                hash: ['page'],
                range: ['rev', 'tid'],  // tid would be included anyway
                // make it easy to get the next revision as well to determine tid upper bound
                order: ['asc','desc'],
                proj: ['deleted']
            }
        }
    };
}

// Sub-buckets for *.html, *.wikitext etc
var revisionedSubBuckets = ['html','wikitext','data-parsoid','data-mw'];

PCBucket.prototype.createBucket = function(restbase, req) {
    var opts = req.body;
    var rp = req.params;
    var revBucketConf = {
        type: 'kv',
        revisioned: true,
        keyType: 'string',
        valueType: 'blob'
    };
    var requests = revisionedSubBuckets.map(function(format) {
        // HTML
        return restbase.put({
            uri: '/v1/' + rp.domain + '/' + rp.bucket + '.' + format,
            body: revBucketConf
        });
    });
    var table = rp.bucket + '.rev';
    var revSchema = getRevSchema;
    revSchema.table = table;
    requests.push(restbase.put({
        uri: '/v1/' + rp.domain + '/' + table,
        body: revSchema
    }));
    return Promise.all(requests)
    .then(function(res) {
        console.log(res);
        return {
            status: 201, // created
            body: {
                type: 'bucket_created',
                title: 'Bucket created.'
            }
        };
    });
};


PCBucket.prototype.listBucket = function(restbase, req, options) {
    // Forward to the revision bucket
    // XXX: instead forward to a page bucket?
    req.uri = req.uri.replace(/\/$/, '.rev/');
    return restbase.get(req);
};

PCBucket.prototype.getLatest = function(restbase, req, options) {
    // Redirect to /html by default
    return Promise.resolve({
        status: 302,
        headers: {
            location: req.uri + '/html'
        }
    });
};


PCBucket.prototype.getLatestFormat = function(restbase, req) {
    var rp = req.params;
    req.uri = '/v1/' + rp.domain + '/' + rp.bucket + '.' + rp.format + '/' + rp.key;
    return restbase.get(req);
};

PCBucket.prototype.putLatestFormat = function(restbase, req) {
    var rp = req.params;
    req.uri = '/v1/' + rp.domain + '/' + rp.bucket + '.' + rp.format + '/' +
        rp.key;
    return restbase.put(req);
};

PCBucket.prototype.listFormatRevisions = function(restbase, req) {
    var rp = req.params;
    req.uri = '/v1/' + rp.domain + '/' + rp.bucket + '.' + rp.format + '/' +
        rp.key + '/';
    return restbase.get(req);
};

function checkResponse(res, restbase, req) {
    var rp = req.params;
    if (rp.format === 'html' && rp.revision) {
        if (res.status === 404) {
            // Try to generate HTML on the fly by calling Parsoid
            // XXX: register as /v1/services/parsoid ?
            var parsoidURL = 'http://parsoid-lb.eqiad.wikimedia.org/'
                    + rp.domain + '/' + rp.key + '?oldid=' + rp.revision;
            return restbase.GET({ uri: parsoidURL })
            .then(function(parsoidResp) {
                // handle the response from Parsoid
                console.log(parsoidResp.status, parsoidResp.headers);
                if (parsoidResp.status === 200) {
                    console.log('PUT', req.uri);
                    // Asynchronously save back the HTML
                    restbase.PUT({
                        uri: req.uri,
                        headers: parsoidResp.headers,
                        body: parsoidResp.body
                    });
                }
                // And return the response to the client
                return parsoidResp;
            });
        }
    }
    return res;
}

PCBucket.prototype.getFormatRevision = function(restbase, req) {
    var rp = req.params;
    req.uri = '/v1/' + rp.domain + '/' + rp.bucket + '.' + rp.format + '/' +
        rp.key + '/' + rp.revision;
    return restbase.get(req)
    .then(checkResponse);
};

module.exports = function(options) {
    var bucket = new PCBucket(options);
    // XXX: add docs
    return {
        paths: {
            '/v1/{domain}/{bucket}': {
                get: { request_handler: bucket.getBucketInfo.bind(bucket) },
                put: { request_handler: bucket.createBucket.bind(bucket) }
            },
            '/v1/{domain}/{bucket}/': {
                get: { request_handler: bucket.listBucket.bind(bucket) }
            },
            '/v1/{domain}/{bucket}/{key}': {
                get: { request_handler: bucket.getLatest.bind(bucket) }
            },
            '/v1/{domain}/{bucket}/{key}/{format}': {
                get: { request_handler: bucket.getLatestFormat.bind(bucket) },
                put: { request_handler: bucket.putLatestFormat.bind(bucket) }
            },
            '/v1/{domain}/{bucket}/{key}/{format}/': {
                get: { request_handler: bucket.listFormatRevisions.bind(bucket) }
            },
            '/v1/{domain}/{bucket}/{key}/{format}/{revision}': {
                put: { request_handler: bucket.getFormatRevision.bind(bucket) }
            }
        }
    };
};
