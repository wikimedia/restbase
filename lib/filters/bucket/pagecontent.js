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
            nextrev: 'varint',      // oldid of next revision, or null
            nextrev_tid: 'timeuuid',// tid of next revision, or null
            latest_tid: 'timeuuid', // static, CAS synchronization point
            // revision metadata in individual attributes for ease of indexing
            user_id: 'varint',      // stable for contributions etc
            user_text: 'string',
            comment: 'string',
            is_minor: 'boolean'
        },
        index: [
            { attribute: 'page', type: 'hash' },
            { attribute: 'latest_tid', type: 'static' },
            { attribute: 'tid', type: 'range', order: 'desc' }
        ],
        secondaryIndexes: {
            // /pages.rev//page/Foo/12345
            // @specific time: /pages.history//rev/12345?ts=20140312T20:22:33.3Z
            rev: [
                { attribute: 'page', type: 'hash' },
                { attribute: 'rev', type: 'range', order: 'desc' },
                { attribute: 'tid', type: 'range', order: 'desc' },
                { attribute: 'deleted', type: 'proj' }
            ]
        }
    };
}

// Sub-buckets for *.html, *.wikitext etc
var revisionedSubBuckets = {
    html: {
        valueType: 'blob',
    },
    wikitext: {
        valueType: 'blob',
    },
    'data-parsoid': {
        valueType: 'json',
    },
    'data-mw': {
        valueType: 'json'
    }
};

PCBucket.prototype.createBucket = function(restbase, req) {
    var opts = req.body;
    var rp = req.params;
    var revBucketConf = {
        type: 'kv',
        revisioned: true,
        keyType: 'string',
        valueType: 'blob'
    };
    var requests = Object.keys(revisionedSubBuckets).map(function(format) {
        // HTML
        var bucketConf = rbUtil.extend({}, revBucketConf);
        bucketConf.valueType = revisionedSubBuckets[format].valueType;
        return restbase.put({
            uri: '/v1/' + rp.domain + '/' + rp.bucket + '.' + format,
            body: bucketConf
        });
    });
    var table = rp.bucket + '.rev';
    var revSchema = getRevSchema();
    revSchema.table = table;
    requests.push(restbase.put({
        uri: '/v1/' + rp.domain + '/' + table,
        body: revSchema
    }));
    return Promise.all(requests)
    .then(function(res) {
        //console.log(JSON.stringify(res,null,2));
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
    req.body = {
        table: req.params.bucket + '.rev',
        proj: ['page'],
        distinct: true
    };
    return restbase.get(req)
    .then(function(res) {
        if (res.status === 200) {
            res.body.items = res.body.items.map(function(row) {
                return row.page;
            });
        }
        return res;
    });
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
    var origURI = req.uri;
    return restbase.post({
        uri: '/v1/' + rp.domain + '/_svc/action/query',
        body: {
            format: 'json',
            action: 'query',
            prop: 'revisions',
            rvprop: 'ids',
            titles: decodeURIComponent(rp.key)
        }
    })
    .then(function(apiRes) {
        var items = apiRes.body && apiRes.body.items;
        if (apiRes.status === 200 && items && items.length) {
            var rev = items[0].revisions[0];
            return {
                status: 302,
                headers: {
                    location: origURI + '/' + rev.revid
                }
            };
        } else {
            return { status: 404 };
        }
    });
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

var contentTypes = {
    html: 'text/html; charset=UTF-8',
    'data-parsoid': 'application/json; profile=mediawiki.org/specs/data-parsoid/1.0'
};

PCBucket.prototype.checkResponse = function (restbase, req, tid, apiRev, res) {
    var self = this;
    var rp = req.params;
    if (rp.format === 'html' || rp.format === 'data-parsoid'
            && rp.revision)
    {
        if (res.status === 404 && /^[0-9]+$/.test(rp.revision)) {
            // Try to generate HTML on the fly by calling Parsoid
            return restbase.get({
                uri: '/v1/' + rp.domain + '/_svc/parsoid/' + rp.key + '/' + rp.revision
            }).then(function(parsoidResp) {
                // handle the response from Parsoid
                //console.log(parsoidResp.status, parsoidResp.headers);
                if (parsoidResp.status === 200) {
                    // console.log('put', req.uri);
                    parsoidResp.headers.etag = tid;
                    Promise.all([
                        restbase.put({
                            uri: '/v1/' + rp.domain + '/' + rp.bucket
                                    + '.html/' + rp.key + '/' + tid,
                            headers: rbUtil.extend({}, parsoidResp.headers,
                                    {'content-type': contentTypes.html}),
                            body: parsoidResp.body.html
                        }),
                        restbase.put({
                            uri: '/v1/' + rp.domain + '/' + rp.bucket
                                    + '.data-parsoid/' + rp.key + '/' + tid,
                            headers: rbUtil.extend({}, parsoidResp.headers,
                                    {'content-type': contentTypes['data-parsoid'] }),
                            body: parsoidResp.body['data-parsoid']
                        }),
                        restbase.put({ // Save / update the revision entry
                            uri: '/v1/' + rp.domain + '/' + rp.bucket + '.rev'
                                + '/' + rp.key,
                            body: {
                                table: rp.bucket + '.rev',
                                attributes: {
                                    page: rp.key,
                                    rev: parseInt(rp.revision),
                                    tid: tid,
                                    user_id: apiRev.userid,
                                    user_text: apiRev.user,
                                    comment: apiRev.comment
                                }
                            }
                        })
                    ]);
                }
                // And return the response to the client
                var resp = {
                    'status': parsoidResp.status,
                    headers: rbUtil.extend({}, parsoidResp.headers),
                    body: parsoidResp.body[rp.format]
                };
                // XXX: Fix Parsoid's content-type, so that we don't need to
                // override this here!
                resp.headers['content-type'] = contentTypes[rp.format];
                return resp;
            });
        }
    }
    return res;
};

PCBucket.prototype.getFormatRevision = function(restbase, req) {
    var self = this;
    var rp = req.params;
    if (/^[0-9]+$/.test(rp.revision)) {
        // Check the local db
        var revTable = rp.bucket + '.rev';
        return restbase.get({
            uri: '/v1/' + rp.domain + '/' + revTable + '/' + rp.key,
            body: {
                table: revTable,
                index: 'rev',
                proj: ['tid'],
                attributes: {
                    page: rp.key,
                    rev: parseInt(rp.revision)
                },
                limit: 2
            }
        })
        .then(function(res) {
            if (res.status === 200) {
                var tid = res.body.items[0].tid;
                req.uri = '/v1/' + rp.domain + '/' + rp.bucket + '.' + rp.format + '/' +
                    rp.key + '/' + tid;
                return restbase.get(req);
            } else {
                // Try to resolve MW oldids to tids
                return restbase.post({
                    uri: '/v1/' + rp.domain + '/_svc/action/query',
                    body: {
                        format: 'json',
                        action: 'query',
                        prop: 'revisions',
                        rvprop: 'ids|timestamp|user|userid|size|sha1|contentmodel|comment',
                            //titles: rp.key,
                        revids: rp.revision
                    }
                })
                .then(function(apiRes) {
                    if (apiRes.status === 200) {
                        var apiRev = apiRes.body.items[0].revisions[0];
                        var tid = rbUtil.tidFromDate(new Date(apiRev.timestamp));
                        req.uri = '/v1/' + rp.domain + '/' + rp.bucket + '.' + rp.format + '/' +
                            rp.key + '/' + tid;
                        return restbase.get(req)
                        // TODO: pass api result to checkResponse
                        .then(self.checkResponse.bind(self, restbase, req, tid, apiRev));
                    } else {
                        // XXX: Return a proper error instead
                        return apiRes;
                    }
                });
            }
        });
    }

    req.uri = '/v1/' + rp.domain + '/' + rp.bucket + '.' + rp.format + '/' +
        rp.key + '/' + rp.revision;
    return restbase.get(req);
};

PCBucket.prototype.putFormatRevision = function(restbase, req) {
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

PCBucket.prototype.listItem = function(restbase, req) {
    return Promise.resolve({
        status: 200,
        body: {
            items: ['html','data-parsoid'],
            comment: 'TODO: update this dynamically from bucket metadata!'
        }
    });
};

PCBucket.prototype.listRevisions = function(restbase, req) {
    var rp = req.params;
    return restbase.get({
        uri: '/v1/' + rp.domain + '/' + rp.bucket + '.rev/' + rp.key + '/',
        body: {
            table: rp.bucket + '.rev',
            attributes: {
                page: rp.key
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

PCBucket.prototype.getRevision = function(restbase, req) {
    var rp = req.params;
    return restbase.get({
        uri: '/v1/' + rp.domain + '/' + rp.bucket + '.rev/' + rp.key + '/'
            + rp.revision,
        body: {
            table: rp.bucket + '.rev',
            attributes: {
                page: rp.key,
                tid: rp.revision
            }
        }
    })
    .then(function(res) {
        // TODO: Decode rev and user_id (or do so in the table store)
        return res;
    });
};

// Temporary / experimental entry point to retrieve the red links in an
// existing revision.
//
// The longer-term implementation plan is to maintain these links as classes
// inline, so this entry point will primarily be used internally.
// TODO:
// - Store the results of this query
// - Possibly integrate in a more general page link entry point
PCBucket.prototype.getRedLinks = function(restbase, req) {
    var rp = req.params;
    function getLinkChunks(missing, gplcontinue) {
        return restbase.get({
            uri: '/v1/' + rp.domain + '/_svc/action/query',
            query: {
                prop: 'info',
                titles: decodeURIComponent(rp.key),
                generator: 'links',
                gpllimit: 500,
                gplcontinue: gplcontinue
            }
        })
        .then(function(res) {
            // Look for 'missing' entries
            res.body.items.forEach(function(link) {
                if (link.missing !== undefined) {
                    missing.push(link.title);
                }
            });
            if (res.body.next) {
                return getLinkChunks(missing, res.body.next.links.gplcontinue);
            } else {
                return missing;
            }
        });
    }

    return getLinkChunks([])
    .then(function(missing) {
        return {
            status: 200,
            headers: {
                'content-type': 'application/json;schema=mediawiki.org/specs/..'
            },
            body: {
                items: missing
            }
        };
    });
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
            '/v1/{domain}/{bucket}/{key}/': {
                get: { request_handler: bucket.listItem.bind(bucket) }
            },
            '/v1/{domain}/{bucket}/{key}/redlinks': {
                get: { request_handler: bucket.getRedLinks.bind(bucket) }
            },
            '/v1/{domain}/{bucket}/{key}/{format}': {
                get: { request_handler: bucket.getLatestFormat.bind(bucket) },
                put: { request_handler: bucket.putLatestFormat.bind(bucket) }
            },
            '/v1/{domain}/{bucket}/{key}/rev/': {
                get: { request_handler: bucket.listRevisions.bind(bucket) }
            },
            '/v1/{domain}/{bucket}/{key}/{format}/': {
                get: { request_handler: bucket.listFormatRevisions.bind(bucket) }
            },
            '/v1/{domain}/{bucket}/{key}/rev/{revision}': {
                get: { request_handler: bucket.getRevision.bind(bucket) }
            },
            '/v1/{domain}/{bucket}/{key}/{format}/{revision}': {
                get: { request_handler: bucket.getFormatRevision.bind(bucket) },
                put: { request_handler: bucket.putFormatRevision.bind(bucket) }
            }
        }
    };
};
