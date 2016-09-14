"use strict";

/**
 * Key-value bucket handler
 */

var uuid = require('cassandra-uuid').TimeUuid;
var mwUtil = require('../lib/mwUtil');
var HyperSwitch = require('hyperswitch');
var HTTPError = HyperSwitch.HTTPError;
var URI = HyperSwitch.URI;

var spec = HyperSwitch.utils.loadSpec(__dirname + '/key_value.yaml');

function KVBucket() {
}

KVBucket.prototype.makeSchema = function(opts) {
    var schemaVersionMajor = 5;

    return {
        // Combine option & bucket version into a monotonically increasing
        // combined schema version. By multiplying the bucket version by 1000,
        // we increase the chance of catching a reset in the option version.
        version: schemaVersionMajor * 1000 + (opts.version || 0),
        options: {
            compression: opts.compression || [
                {
                    algorithm: 'deflate',
                    block_size: 256
                }
            ],
            updates: opts.updates || {
                pattern: 'timeseries'
            },
        },
        revisionRetentionPolicy: opts.retention_policy || {
            type: 'latest',
            count: 1,
            grace_ttl: 86400
        },
        attributes: {
            key: opts.keyType || 'string',
            tid: 'timeuuid',
            latestTid: 'timeuuid',
            value: opts.valueType || 'blob',
            'content-type': 'string',
            'content-sha256': 'blob',
            // Redirect
            'content-location': 'string',
            tags: 'set<string>',
            headers: 'json'
        },
        index: [
            { attribute: 'key', type: 'hash' },
            { attribute: 'tid', type: 'range', order: 'desc' }
        ]
    };
};

KVBucket.prototype.createBucket = function(hyper, req) {
    var schema = this.makeSchema(req.body || {});
    schema.table = req.params.bucket;
    var rp = req.params;
    var storeRequest = {
        uri: new URI([rp.domain, 'sys', 'table', rp.bucket]),
        body: schema
    };
    return hyper.put(storeRequest);
};

// Format a revision response. Shared between different ways to retrieve a
// revision (latest & with explicit revision).
function returnRevision(req) {
    return function(dbResult) {
        if (dbResult.body && dbResult.body.items && dbResult.body.items.length) {
            var row = dbResult.body.items[0];
            var headers = {
                etag: mwUtil.makeETag('0', row.tid),
                'content-type': row['content-type']
            };
            if (row.headers) {
                headers = Object.assign(headers, row.headers);
            }
            return {
                status: 200,
                headers: headers,
                body: row.value
            };
        } else {
            throw new HTTPError({
                status: 404,
                body: {
                    type: 'not_found',
                    uri: req.uri,
                    method: req.method
                }
            });
        }
    };
}

KVBucket.prototype.getRevision = function(hyper, req) {
    if (mwUtil.isNoCacheRequest(req)) {
        throw new HTTPError({ status: 404 });
    }

    var rp = req.params;
    var storeReq = {
        uri: new URI([rp.domain, 'sys', 'table', rp.bucket, '']),
        body: {
            table: rp.bucket,
            attributes: {
                key: rp.key
            },
            limit: 1
        }
    };
    if (rp.tid) {
        storeReq.body.attributes.tid = mwUtil.coerceTid(rp.tid, 'key_value');
    }
    return hyper.get(storeReq).then(returnRevision(req));
};


KVBucket.prototype.listRevisions = function(hyper, req) {
    var rp = req.params;
    var storeRequest = {
        uri: new URI([rp.domain, 'sys', 'table', rp.bucket, '']),
        body: {
            table: req.params.bucket,
            attributes: {
                key: req.params.key
            },
            proj: ['tid'],
            limit: 1000
        }
    };
    return hyper.get(storeRequest)
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


KVBucket.prototype.putRevision = function(hyper, req) {
    // TODO: support other formats! See cassandra backend getRevision impl.
    var rp = req.params;
    var tid = rp.tid && mwUtil.coerceTid(rp.tid, 'key_value');

    if (!tid) {
        tid = (mwUtil.parseETag(req.headers && req.headers.etag) || {}).tid;
        tid = tid || uuid.now().toString();
    }

    return hyper.put({
        uri: new URI([rp.domain, 'sys', 'table', rp.bucket, '']),
        body: {
            table: rp.bucket,
            attributes: {
                key: rp.key,
                tid: tid,
                value: req.body,
                headers: req.headers,
                'content-type': req.headers && req.headers['content-type']
                // TODO: include other data!
            }
        }
    })
    .then(function(res) {
        if (res.status === 201) {
            return {
                status: 201,
                headers: {
                    etag: req.headers && req.headers.etag || mwUtil.makeETag('0', tid)
                },
                body: {
                    message: "Created.",
                    tid: tid
                }
            };
        } else {
            throw res;
        }
    })
    .catch(function(error) {
        hyper.log('error/kv/putRevision', error);
        return { status: 400 };
    });
};

module.exports = function(options) {
    var kvBucket = new KVBucket(options);

    return {
        spec: spec, // Re-export from spec module
        operations: {
            createBucket: kvBucket.createBucket.bind(kvBucket),
            listRevisions: kvBucket.listRevisions.bind(kvBucket),
            getRevision: kvBucket.getRevision.bind(kvBucket),
            putRevision: kvBucket.putRevision.bind(kvBucket)
        }
    };
};
