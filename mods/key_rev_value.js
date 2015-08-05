"use strict";

/**
 * Key-rev-value bucket handler
 */

var P = require('bluebird');
var uuid = require('cassandra-uuid').TimeUuid;
var rbUtil = require('../lib/rbUtil');
var URI = require('swagger-router').URI;

// TODO: move to separate spec package
var yaml = require('js-yaml');
var fs = require('fs');
var spec = yaml.safeLoad(fs.readFileSync(__dirname + '/key_rev_value.yaml'));

var backend;
var config;

function KRVBucket(options) {
    this.log = options.log || function() {};
}

KRVBucket.prototype.getBucketInfo = function(restbase, req, options) {
    var self = this;
    return P.resolve({
        status: 200,
        body: options,
    });
};

KRVBucket.prototype.makeSchema = function(opts) {
    var schemaVersionMajor = 1;

    var schema =  {
        options: {
            compression: [
                {
                    algorithm: 'deflate',
                    block_size: 256,
                },
            ],
        },
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
            tags: 'set<string>',
        },
        index: [
            { attribute: 'key', type: 'hash' },
            { attribute: 'rev', type: 'range', order: 'desc', },
            { attribute: 'tid', type: 'range', order: 'desc', },
        ],
    };

    if (opts.revisionRetentionPolicy) {
        schema.revisionRetentionPolicy = opts.revisionRetentionPolicy;
    }
    if (opts.version) {
        schema.version = schemaVersionMajor + opts.version;
    }

    return schema;
};

KRVBucket.prototype.createBucket = function(restbase, req) {
    var opts = req.body;
    if (!opts.type) { opts.type = 'key_rev_value'; }
    if (!opts.keyType) { opts.keyType = 'string'; }
    if (!opts.valueType) { opts.valueType = 'blob'; }
    var schema = this.makeSchema(opts);
    schema.table = req.params.bucket;
    var rp = req.params;
    var storeRequest = {
        uri: new URI([rp.domain, 'sys', 'table', rp.bucket, ]),
        body: schema,
    };
    return restbase.put(storeRequest);
};


KRVBucket.prototype.getListQuery = function(options, bucket) {
    return {
        table: bucket,
        distinct: true,
        proj: 'key',
        limit: 1000,
    };
};



KRVBucket.prototype.listBucket = function(restbase, req, options) {
    var self = this;
    // XXX: check params!
    var rp = req.params;

    var listQuery = this.getListQuery(options, rp.bucket);
    return restbase.get({
        uri: new URI([rp.domain, 'sys', 'table', rp.bucket, '', ]),
        body: listQuery,
    })
    .then(function(result) {
        var listing = result.body.items.map(function(row) {
            return row.key;
        });
        return {
            status: 200,
            headers: {
                'content-type': 'application/json',
            },
            body: {
                items: listing,
            },
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
                'content-type': row['content-type'],
            };
            return {
                status: 200,
                headers: headers,
                body: row.value,
            };
        } else {
            throw new rbUtil.HTTPError({
                status: 404,
                body: {
                    type: 'not_found',
                    uri: req.uri,
                    method: req.method,
                },
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
            tid: tidString,
        },
    });
}

function parseRevision(rev) {
    if (!/^[0-9]+/.test(rev)) {
        throw new rbUtil.HTTPError({
            status: 400,
            body: {
                type: 'key_rev_value/invalid_revision',
                title: 'Invalid revision parameter',
                rev: rev,
            },
        });
    }

    return parseInt(rev);
}

KRVBucket.prototype.getRevision = function(restbase, req) {
    var rp = req.params;
    var storeReq = {
        uri: new URI([rp.domain, 'sys', 'table', rp.bucket, '', ]),
        body: {
            table: rp.bucket,
            attributes: {
                key: rp.key,
            },
            limit: 1,
        },
    };
    if (rp.revision) {
        storeReq.body.attributes.rev = parseRevision(rp.revision);
        if (rp.tid) {
            storeReq.body.attributes.tid = coerceTid(rp.tid);
        }
    }
    return restbase.get(storeReq).then(returnRevision(req));
};


KRVBucket.prototype.listRevisions = function(restbase, req) {
    var rp = req.params;
    var storeRequest = {
        uri: new URI([rp.domain, 'sys', 'table', rp.bucket, '', ]),
        body: {
            table: req.params.bucket,
            attributes: {
                key: req.params.key,
            },
            proj: ['rev', 'tid'],
            limit: (req.body && req.body.limit) ?
                        req.body.limit : restbase.rb_config.default_page_size,
        },
    };
    if (rp.revision) {
        storeRequest.body.attributes.rev = parseRevision(rp.revision);
    }
    return restbase.get(storeRequest)
    .then(function(res) {
        return {
            status: 200,
            headers: {
                'content-type': 'application/json',
            },
            body: {
                items: res.body.items.map(function(row) {
                    return { revision: row.rev, tid: row.tid, };
                }),
                next: res.body.next,
            },
        };
    });
};


KRVBucket.prototype.putRevision = function(restbase, req) {
    var rp = req.params;
    var rev = parseRevision(rp.revision);
    var tid = rp.tid && coerceTid(rp.tid) || uuid.now().toString();
    if (req.headers['last-modified']) {
        // XXX: require elevated rights for passing in the revision time
        tid = rbUtil.tidFromDate(req.headers['last-modified']);
    }

    var storeReq = {
        uri: new URI([rp.domain, 'sys', 'table', rp.bucket, '', ]),
        body: {
            table: rp.bucket,
            attributes: {
                key: rp.key,
                rev: rev,
                tid: tid,
                value: req.body,
                'content-type': req.headers['content-type'],
                // TODO: include other data!
            },
        },
    };
    return restbase.put(storeReq)
    .then(function(res) {
        if (res.status === 201) {
            return {
                status: 201,
                headers: {
                    etag: rbUtil.makeETag(rp.revision, tid),
                },
                body: {
                    message: "Created.",
                    tid: rp.revision,
                },
            };
        } else {
            throw res;
        }
    })
    .catch(function(error) {
        restbase.log('error/kv/putRevision', error);
        return { status: 400, };
    });
};

module.exports = function(options) {
    var krvBucket = new KRVBucket(options);

    return {
        spec: spec, // Re-export from spec module
        operations: {
            getBucketInfo: krvBucket.getBucketInfo.bind(krvBucket),
            createBucket: krvBucket.createBucket.bind(krvBucket),
            listBucket: krvBucket.listBucket.bind(krvBucket),
            listRevisions: krvBucket.listRevisions.bind(krvBucket),
            getRevision: krvBucket.getRevision.bind(krvBucket),
            putRevision: krvBucket.putRevision.bind(krvBucket),
        },
    };
};
