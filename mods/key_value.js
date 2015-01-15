"use strict";

/**
 * Key-value bucket handler
 */

var uuid = require('node-uuid');
var rbUtil = require('../lib/rbUtil');
var URI = require('../lib/router').URI;

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
            index: [
                { attribute: 'key', type: 'hash' },
                { attribute: 'latestTid', type: 'static' },
                { attribute: 'tid', type: 'range', order: 'desc' }
            ]
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
    if (!opts.revisioned) { opts.revisioned = true; } // No choice..
    var schema = this.makeSchema(opts);
    schema.table = req.params.bucket;
    var rp = req.params;
    var storeRequest = {
        uri: new URI([rp.domain,'sys','table',rp.bucket]),
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
    var rp = req.params;

    var listQuery = this.getListQuery(options, rp.bucket);
    return restbase.get({
        uri: new URI([rp.domain,'sys','table',rp.bucket,'']),
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
            body: {
                items: listing
            }
        };
    })
    .catch(function(error) {
        self.log('error/kv/listBucket', error);
        return { status: 404 };
    });
};

// Format a revision response. Shared between different ways to retrieve a
// revision (latest & with explicit revision).
function returnRevision(req) {
    return function (dbResult) {
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
}

function getRevision(restbase, req, revPred) {
    var rp = req.params;
    if (revPred === null) {
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
        uri: new URI([rp.domain,'sys','table',rp.bucket]),
        body: {
            table: rp.bucket,
            attributes: {
                key: rp.title,
                tid: revPred
            }
        }
    };
    return restbase.get(storeReq).then(returnRevision(req));
}


KVBucket.prototype.getLatest = function(restbase, req) {
    if (req.body) {
        return getRevision(restbase, req, req.body);
    }
    var rp = req.params;
    return restbase.get(new URI([rp.domain,'sys','table',rp.bucket,'latest']));
};

KVBucket.prototype.putLatest = function(restbase, req) {
    var self = this;
    var rp = req.params;

    var tid = uuid.v1();
    if (req.headers['last-modified']) {
        try {
            // XXX: require elevated rights for passing in the revision time
            tid = rbUtil.tidFromDate(req.headers['last-modified']);
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
        uri: new URI([rp.domain,'sys','table',rp.bucket]),
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
    var rp = req.params;
    var storeRequest = {
        uri: new URI([rp.domain,'sys','table',rp.bucket]),
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
            body: {
                items: res.body.items.map(function(row) {
                    return row.tid;
                })
            }
        };
    });
};

var uuidRe = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
function getRevisionPredicate (revString) {
    var rev = null;

    if (revString === 'latest') {
        // latest revision
        rev = revString;
    } else if (/^\d{4}-\d{2}-\d{2}/.test(revString)) {
        // timestamp
        var revTime = Date.parse(revString);
        if (isNaN(revTime)) {
            // invalid date
            return Promise.resolve({
                status: 400,
                body: 'Invalid date'
            });
        }
        rev = {
            le: rbUtil.tidFromDate(revTime)
        };
    } else if (uuidRe.test(revString)) {
        // uuid
        rev = revString;
    }
    return rev;
}

KVBucket.prototype.getRevision = function(restbase, req) {
    // TODO: support other formats! See cassandra backend getRevision impl.
    var revPred = getRevisionPredicate(req.params.revision);
    return getRevision(restbase, req, revPred);
};

KVBucket.prototype.putRevision = function(restbase, req) {
    // TODO: support other formats! See cassandra backend getRevision impl.
    var rp = req.params;
    var rev = getRevisionPredicate(rp.revision);
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

    if (typeof rev === 'object') {
        // XXX: Restrict access to passing in an explicit revision id via a
        // timestamp
        rev = rev.le;
    }

    var storeReq = {
        uri: new URI([rp.domain,'sys','table',rp.bucket]),
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
            throw res;
        }
    })
    .catch(function(error) {
        restbase.log('error/kv/putRevision', error);
        return { status: 400 };
    });
};

module.exports = function(options) {
    var revBucket = new KVBucket(options);
    return {
        getBucketInfo: revBucket.getBucketInfo.bind(revBucket),
        createBucket: revBucket.createBucket.bind(revBucket),
        listBucket: revBucket.listBucket.bind(revBucket),
        getLatest: revBucket.getLatest.bind(revBucket),
        putLatest: revBucket.putLatest.bind(revBucket),
        listRevisions: revBucket.listRevisions.bind(revBucket),
        getRevision: revBucket.getRevision.bind(revBucket),
        putRevision: revBucket.putRevision.bind(revBucket)
    };
};
