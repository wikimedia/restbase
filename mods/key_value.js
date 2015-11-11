"use strict";

/**
 * Key-value bucket handler
 */

var P = require('bluebird');
var uuid = require('cassandra-uuid').TimeUuid;
var rbUtil = require('../lib/rbUtil');
var HTTPError = rbUtil.HTTPError;
var URI = require('swagger-router').URI;

// TODO: move to separate spec package
var yaml = require('js-yaml');
var fs = require('fs');
var spec = yaml.safeLoad(fs.readFileSync(__dirname + '/key_value.yaml'));

var backend;
var config;

function KVBucket(options) {
    this.log = options.log || function() {};
}

KVBucket.prototype.getBucketInfo = function(restbase, req, options) {
    var self = this;
    return P.resolve({
        status: 200,
        body: options
    });
};

KVBucket.prototype.makeSchema = function(opts) {
    opts.schemaVersion = 2;
    return {
        version: opts.schemaVersion,
        options: {
            compression: [
                {
                    algorithm: 'deflate',
                    block_size: 256
                }
            ]
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

KVBucket.prototype.createBucket = function(restbase, req) {
    var opts = req.body || {};
    if (!opts.keyType) { opts.keyType = 'string'; }
    if (!opts.valueType) { opts.valueType = 'blob'; }
    if (!opts.revisioned) { opts.revisioned = true; } // No choice..
    var schema = this.makeSchema(opts);
    schema.table = req.params.bucket;
    var rp = req.params;
    var storeRequest = {
        uri: new URI([rp.domain, 'sys', 'table', rp.bucket]),
        body: schema
    };
    return restbase.put(storeRequest);
};


KVBucket.prototype.getListQuery = function(options, bucket) {
    return {
        table: bucket,
        distinct: true,
        proj: 'key',
        limit: 1000
    };
};



KVBucket.prototype.listBucket = function(restbase, req, options) {
    var self = this;
    // XXX: check params!
    var rp = req.params;

    var listQuery = this.getListQuery(options, rp.bucket);
    return restbase.get({
        uri: new URI([rp.domain, 'sys', 'table', rp.bucket, '']),
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
        throw new rbUtil.HTTPError({ status: 404 });
    });
};

// Format a revision response. Shared between different ways to retrieve a
// revision (latest & with explicit revision).
function returnRevision(req) {
    return function(dbResult) {
        if (dbResult.body && dbResult.body.items && dbResult.body.items.length) {
            var row = dbResult.body.items[0];
            var headers = {
                etag: rbUtil.makeETag(row.rev, row.tid),
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
            throw new rbUtil.HTTPError({
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

function coerceTid(tidString) {
    if (rbUtil.isTimeUUID(tidString)) {
        return tidString;
    }

    if (/^\d{4}-\d{2}-\d{2}/.test(tidString)) {
        // Timestamp
        try {
            return rbUtil.tidFromDate(tidString);
        } catch (e) {} // Fall through
    }

    // Out of luck
    throw new rbUtil.HTTPError({
        status: 400,
        body: {
            type: 'key_rev_value/invalid_tid',
            title: 'Invalid tid parameter',
            tid: tidString
        }
    });
}

function parseRevision(rev) {
    if (!/^[0-9]+/.test(rev)) {
        throw new rbUtil.HTTPError({
            status: 400,
            body: {
                type: 'key_rev_value/invalid_revision',
                title: 'Invalid revision parameter',
                rev: rev
            }
        });
    }

    return parseInt(rev);
}

KVBucket.prototype.getRevision = function(restbase, req) {
    if (req.headers && /no-cache/i.test(req.headers['cache-control'])) {
        throw new HTTPError({
            status: 404
        });
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
        storeReq.body.attributes.tid = coerceTid(rp.tid);
    }
    return restbase.get(storeReq).then(returnRevision(req));
};


KVBucket.prototype.listRevisions = function(restbase, req) {
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


KVBucket.prototype.putRevision = function(restbase, req) {
    // TODO: support other formats! See cassandra backend getRevision impl.
    var rp = req.params;
    var tid = rp.tid && coerceTid(rp.tid);

    if (!tid) {
        tid = (rbUtil.parseETag(req.headers && req.headers.etag) || {}).tid;
        tid = tid || uuid.now().toString();
    }

    var storeReq = {
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
    };
    return restbase.put(storeReq)
    .then(function(res) {
        if (res.status === 201) {
            return {
                status: 201,
                headers: {
                    etag: rbUtil.makeETag(rp.revision, tid)
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
    var kvBucket = new KVBucket(options);

    return {
        spec: spec, // Re-export from spec module
        operations: {
            getBucketInfo: kvBucket.getBucketInfo.bind(kvBucket),
            createBucket: kvBucket.createBucket.bind(kvBucket),
            listBucket: kvBucket.listBucket.bind(kvBucket),
            listRevisions: kvBucket.listRevisions.bind(kvBucket),
            getRevision: kvBucket.getRevision.bind(kvBucket),
            putRevision: kvBucket.putRevision.bind(kvBucket)
        }
    };
};
