"use strict";

/**
 * Key-rev-value bucket handler
 */

var uuid = require('cassandra-uuid').TimeUuid;
var mwUtil = require('../lib/mwUtil');
var HyperSwitch = require('hyperswitch');
var HTTPError = HyperSwitch.HTTPError;
var URI = HyperSwitch.URI;
var spec = HyperSwitch.utils.loadSpec(__dirname + '/key_rev_value.yaml');

function KRVBucket() {
}

KRVBucket.prototype.makeSchema = function(opts) {
    var schemaVersionMajor = 2;

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
        revisionRetentionPolicy: opts.retention_policy
            // Deprecated version. TODO: Remove eventually.
            || opts.revisionRetentionPolicy,
        attributes: {
            key: opts.keyType || 'string',
            rev: 'int',
            tid: 'timeuuid',
            latestTid: 'timeuuid',
            value: opts.valueType || 'blob',
            'content-type': 'string',
            'content-sha256': 'blob',
            // Redirect
            'content-location': 'string',
            tags: 'set<string>'
        },
        index: [
            { attribute: 'key', type: 'hash' },
            { attribute: 'rev', type: 'range', order: 'desc' },
            { attribute: 'tid', type: 'range', order: 'desc' }
        ]
    };
};

KRVBucket.prototype.createBucket = function(hyper, req) {
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
                etag: mwUtil.makeETag(row.rev, row.tid),
                'content-type': row['content-type']
            };
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

KRVBucket.prototype.getRevision = function(hyper, req) {
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
    if (rp.revision) {
        storeReq.body.attributes.rev = mwUtil.parseRevision(rp.revision, 'key_rev_value');
        if (rp.tid) {
            storeReq.body.attributes.tid = mwUtil.coerceTid(rp.tid, 'key_rev_value');
        }
    }
    return hyper.get(storeReq).then(returnRevision(req));
};

KRVBucket.prototype.listRevisions = function(hyper, req) {
    var rp = req.params;
    return hyper.get({
        uri: new URI([rp.domain, 'sys', 'table', rp.bucket, '']),
        body: {
            table: req.params.bucket,
            attributes: {
                key: req.params.key
            },
            proj: ['rev', 'tid'],
            limit: mwUtil.getLimit(hyper, req)
        }
    })
    .then(function(res) {
        return {
            status: 200,
            headers: {
                'content-type': 'application/json'
            },
            body: {
                items: res.body.items.map(function(row) {
                    return { revision: row.rev, tid: row.tid };
                }),
                next: res.body.next
            }
        };
    });
};


KRVBucket.prototype.putRevision = function(hyper, req) {
    var rp = req.params;
    var rev = mwUtil.parseRevision(rp.revision, 'key_rev_value');

    var tid = rp.tid && mwUtil.coerceTid(rp.tid, 'key_rev_value') || uuid.now().toString();
    return hyper.put({
        uri: new URI([rp.domain, 'sys', 'table', rp.bucket, '']),
        body: {
            table: rp.bucket,
            attributes: {
                key: rp.key,
                rev: rev,
                tid: tid,
                value: req.body,
                'content-type': req.headers['content-type']
                // TODO: include other data!
            }
        }
    })
    .then(function(res) {
        if (res.status === 201) {
            return {
                status: 201,
                headers: {
                    etag: mwUtil.makeETag(rp.revision, tid)
                },
                body: {
                    message: "Created.",
                    tid: rp.revision
                }
            };
        } else {
            throw res;
        }
    }, function(error) {
        hyper.log('error/krv/putRevision', error);
        return { status: 400 };
    });
};

module.exports = function(options) {
    var krvBucket = new KRVBucket(options);

    return {
        spec: spec, // Re-export from spec module
        operations: {
            createBucket: krvBucket.createBucket.bind(krvBucket),
            listRevisions: krvBucket.listRevisions.bind(krvBucket),
            getRevision: krvBucket.getRevision.bind(krvBucket),
            putRevision: krvBucket.putRevision.bind(krvBucket)
        }
    };
};
