"use strict";

/**
 * Key-value bucket handler
 */

var RouteSwitch = require('routeswitch');
var uuid = require('node-uuid');
var rbUtil = require('../../util.js');

var backend;
var config;

function KVBucket (options) {
    this.log = options.log || function(){};
}

KVBucket.prototype.getBucketInfo = function(restbase, req, options) {
    var self = this;
    return Promise.resolve({
        status: 200,
        body: options
    });
};

KVBucket.prototype.makeSchema = function (opts) {
    if (opts.type === 'kv') {
        opts.schemaVersion = 1;
        return {
            // Associate this bucket with the table
            bucket: opts,
            attributes: {
                key: opts.keyType || 'string',
                tid: 'timeuuid',
                latestTid: 'timeuuid',
                value: opts.valueType || 'blob',
                'content-type': 'string',
                'content-length': 'varint',
                'content-sha256': 'string',
                // redirect
                'content-location': 'string',
                // 'deleted', 'nomove' etc?
                tags: 'set<string>',
            },
            index: {
                hash: 'key',
                range: 'tid',
                order: 'desc',
                static: 'latestTid'
            }
        };
    } else {
        throw new Error('Bucket type ' + opts.type + ' not yet implemented');
    }
};

KVBucket.prototype.createBucket = function(restbase, req) {
    if (!req.body
            || req.body.constructor !== Object
            || req.body.type !== 'kv' )
    {
        // XXX: validate with JSON schema
        var exampleBody = {
            type: 'kv',
            revisioned: true,
            keyType: 'string',
            valueType: 'blob'
        };

        return Promise.resolve({
            status: 400,
            body: {
                type: 'invalid_bucket_schema_kv',
                message: "Expected JSON body describing the bucket.",
                example: exampleBody
            }
        });
    }
    var opts = req.body;
    if (!opts.keyType) { opts.keyType = 'string'; }
    if (!opts.valueType) { opts.valueType = 'blob'; }
    if (!opts.revisioned) { opts.revisioned = true; }
    var schema = this.makeSchema(opts);
    schema.table = req.params.bucket;
    var storeRequest = {
        uri: '/v1/' + req.params.domain + '/' + req.params.bucket,
        body: schema
    };
    return restbase.put(storeRequest);
};


KVBucket.prototype.getListQuery = function (options, bucket) {
    // TODO: support other bucket types
    //if (!options.revisioned || options.ordered) {
    //    throw new Error('Only unordered & revisioned key-value buckets supported to far');
    //}
    return {
        table: bucket,
        distinct: true,
        proj: 'key',
        limit: 10000
    };
};



KVBucket.prototype.listBucket = function(restbase, req, options) {
    var self = this;
    // XXX: check params!
    var params = req.params;

    var listQuery = this.getListQuery(options, params.bucket);
    return restbase.get({
        uri: req.uri,
        body: listQuery
    })
    .then(function(result) {
        var listing = result.body.items.map(function(row) {
            return row.key;
        });
        return {
            status: 200,
            headers: {
                'content-type': 'application/json'
            },
            body: listing
        };
    })
    .catch(function(error) {
        self.log('error/kv/listBucket', error);
        return { status: 404 };
    });
};

// Format a revision response. Shared between different ways to retrieve a
// revision (latest & with explicit revision).
KVBucket.prototype.returnRevision = function(req, dbResult) {
    //console.log(req, dbResult);
    if (dbResult.body && dbResult.body.items && dbResult.body.items.length) {
        var row = dbResult.body.items[0];
        var headers = {
            etag: row.tid,
            'content-type': row['content-type']
        };
        return {
            status: 200,
            headers: headers,
            body: row.value
        };
    } else {
        return {
            status: 404,
            body: {
                type: 'not_found',
                uri: req.uri,
                method: req.method
            }
        };
    }
};

KVBucket.prototype.getLatest = function(restbase, req, options) {
    // XXX: check params!
    var query = {
        table: req.params.bucket,
        attributes: {
            key: req.params.key
        },
        limit: 1
    };

    return restbase.get({
        uri: req.uri,
        body: query
    })
    .then(this.returnRevision.bind(this, req))
    .catch(function(error) {
        console.error(error);
        return { status: 404 };
    });
};

KVBucket.prototype.putLatest = function(restbase, req) {
    var self = this;

    var tid = uuid.v1();
    if (req.headers['last-modified']) {
        try {
            // XXX: require elevated rights for passing in the revision time
            tid = rbUtil.tidFromDate(new Date(req.headers['last-modified']));
        } catch (e) { }
    }

    var query = {
        table: req.params.bucket,
        attributes: {
            key: req.params.key,
            tid: tid,
            value: req.body,
            'content-type': req.headers['content-type']
        }
    };
    var request = {
        uri: req.uri,
        body: query
    };

    return restbase.put(request)
    .then(function(result) {
        return {
            status: 201,
            headers: {
                etag: tid
            },
            body: {
                message: "Created.",
                tid: tid
            }
        };
    })
    .catch(function(err) {
        self.log(err.stack);
        return {
            status: 500,
            body: {
                message: "Unknown error\n" + err.stack
            }
        };
    });
};

KVBucket.prototype.listRevisions = function(restbase, req) {
    var storeRequest = {
        uri: req.uri,
        body: {
            table: req.params.bucket,
            attributes: {
                key: req.params.key
            },
            proj: ['tid']
        }
    };
    return restbase.get(storeRequest)
    .then(function(res) {
        return {
            status: 200,
            headers: {
                'content-type': 'application/json'
            },
            body: res.body.items.map(function(row) {
                        return row.tid;
                  })
        };
    });
};

var uuidRe = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
function validateRevision (revString) {
    var rev = null;

    if (revString === 'latest') {
        // latest revision
        rev = revString;
    //} else if (/^\d+$/.test(revString)) {
    //    // oldid
    //    // XXX: move to mw-pagecontent bucket
    //    rev = Number(revString);
    } else if (/^\d{4}-\d{2}-\d{2}/.test(revString)) {
        // timestamp
        rev = new Date(revString);
        if (isNaN(rev.valueOf())) {
            // invalid date
            return Promise.resolve({
                status: 400,
                body: 'Invalid date'
            });
        }
    } else if (uuidRe.test(revString)) {
        // uuid
        rev = revString;
    }
    return rev;
}

KVBucket.prototype.getRevision = function(restbase, req) {
    var rp = req.params;
    // TODO: support other formats! See cassandra backend getRevision impl.
    var rev = validateRevision(req.params.revision);
    if (rev === null) {
        return Promise.resolve({
            status: 400,
            body: {
                type: 'invalid_revision_parameter',
                title: 'Invalid revision parameter.',
                revision: req.params.revision
            }
        });
    }
    var storeReq = {
        uri: req.uri,
        body: {
            table: rp.bucket,
            attributes: {
                key: req.params.key,
                tid: rev
            }
        }
    };
    return restbase.get(storeReq)
    .then(this.returnRevision.bind(this, req));
};

KVBucket.prototype.putRevision = function(restbase, req) {
    // TODO: support other formats! See cassandra backend getRevision impl.
    var rp = req.params;
    var rev = validateRevision(rp.revision);
    if (rev === null) {
        return Promise.resolve({
            status: 400,
            body: {
                type: 'invalid_revision_parameter',
                title: 'Invalid revision parameter.',
                revision: rp.revision
            }
        });
    }
    var storeReq = {
        uri: req.uri,
        body: {
            table: rp.bucket,
            attributes: {
                key: rp.key,
                tid: rev,
                value: req.body,
                'content-type': req.headers['content-type']
                // TODO: include other data!
            }
        }
    };
    return restbase.put(storeReq)
    .then(function(res) {
        if (res.status === 201) {
            return {
                status: 201,
                headers: {
                    etag: rp.revision
                },
                body: {
                    message: "Created.",
                    tid: rp.revision
                }
            };
        } else {
            throw result;
        }
    })
    .catch(function(error) {
        console.error(error);
        return { status: 404 };
    });
};


module.exports = function(options) {
    var revBucket = new KVBucket(options);
    // XXX: add docs
    return {
        paths: {
            '/v1/{domain}/{bucket}': {
                get: { request_handler: revBucket.getBucketInfo.bind(revBucket) },
                put: { request_handler: revBucket.createBucket.bind(revBucket) }
            },
            '/v1/{domain}/{bucket}/': {
                get: { request_handler: revBucket.listBucket.bind(revBucket) }
            },
            '/v1/{domain}/{bucket}/{key}': {
                get: { request_handler: revBucket.getLatest.bind(revBucket) },
                put: { request_handler: revBucket.putLatest.bind(revBucket) }
            },
            '/v1/{domain}/{bucket}/{key}/': {
                get: { request_handler: revBucket.listRevisions.bind(revBucket) },
            },
            '/v1/{domain}/{bucket}/{key}/{revision}': {
                get: { request_handler: revBucket.getRevision.bind(revBucket) },
                put: { request_handler: revBucket.putRevision.bind(revBucket) }
            }
        }
    };
};
