"use strict";

var P = require('bluebird');
var uuid = require('cassandra-uuid').TimeUuid;
var mwUtil = require('../lib/mwUtil');
var HTTPError = require('../lib/exports').HTTPError;
var URI = require('swagger-router').URI;
var preq = require('preq');

var yaml = require('js-yaml');
var fs = require('fs');
var spec = yaml.safeLoad(fs.readFileSync(__dirname + '/chunked_bucket.yaml'));

/**
 * The chunk size to use for data slicing
 * @type {number}
 * @const
 */
var CHUNK_SIZE = 31000;

/**
 * The grace_ttl parameter for a revision policy
 * @type {number}
 * @const
 */
var GRACE_TTL = 86400;

function range(N) {
    return Array.apply(null, { length: N }).map(Number.call, Number);
}

function ChunkedBucket(options) {
    this.log = options.log || function() {};
}

ChunkedBucket.prototype._sliceData = function(data) {
    var slicer;
    if (Buffer.isBuffer(data)) {
        slicer = Buffer.prototype.slice;
    } else {
        data = data.toString();
        slicer = String.prototype.substring;
    }
    var result = [];
    for (var index = 0; index < data.length; index += CHUNK_SIZE) {
        result.push(slicer.call(data, index, index + CHUNK_SIZE));
    }
    return result;
};

ChunkedBucket.prototype._joinData = function(dataParts) {
    if (!dataParts || !dataParts.length) {
        return '';
    } else if (Buffer.isBuffer(dataParts[0])) {
        return Buffer.concat(dataParts);
    } else {
        return String.prototype.concat.apply(dataParts[0], dataParts.slice(1));
    }
};

ChunkedBucket.prototype._metaTableName = function(req) {
    return req.params.bucket + '_meta';
};

ChunkedBucket.prototype._chunksTableName = function(req) {
    return req.params.bucket + '_chunks';
};

ChunkedBucket.prototype._makeMetaSchema = function(opts) {
    var schemaVersionMajor = 1;

    return {
        version: schemaVersionMajor * 1000 + (opts.version || 0),
        options: {
            compression: opts.compression || [
                {
                    algorithm: 'deflate',
                    block_size: 1024
                }
            ]
        },
        attributes: {
            key: opts.keyType || 'string',
            rev: 'int',
            tid: 'timeuuid',
            num: 'int',
            headers: 'json'
        },
        index: [
            { attribute: 'key', type: 'hash' },
            { attribute: 'rev', type: 'range', order: 'desc' },
            { attribute: 'tid', type: 'range', order: 'desc' }
        ]
    };
};

ChunkedBucket.prototype._makeChunksSchema = function(opts) {
    var schemaVersionMajor = 1;

    return {
        version: schemaVersionMajor * 1000 + (opts.version || 0),
        options: {
            compression: opts.compression || [
                {
                    algorithm: 'deflate',
                    block_size: 1024
                }
            ]
        },
        attributes: {
            key: opts.keyType || 'string',
            chunk_id: 'int',
            tid: 'timeuuid',
            value: opts.valueType || 'blob'
        },
        index: [
            { attribute: 'key', type: 'hash' },
            { attribute: 'chunk_id', type: 'hash' },
            { attribute: 'tid', type: 'range', order: 'desc' }
        ]
    };
};

ChunkedBucket.prototype.createBucket = function(restbase, req) {
    var metaSchema = this._makeMetaSchema(req.body || {});
    var dataSchema = this._makeChunksSchema(req.body || {});
    metaSchema.table = this._metaTableName(req);
    dataSchema.table = this._chunksTableName(req);
    return P.join(
        restbase.put({
            uri: new URI([req.params.domain, 'sys', 'table', metaSchema.table]),
            body: metaSchema
        }),
        restbase.put({
            uri: new URI([req.params.domain, 'sys', 'table', dataSchema.table]),
            body: dataSchema
        }))
    .then(function() { return { status: 201 }; });
};

// Format a revision response. Shared between different ways to retrieve a
// revision (latest & with explicit revision).
function returnRevision(req, metadata) {
    return function(dbResult) {
        if (dbResult.body && dbResult.body.items && dbResult.body.items.length) {
            var row = dbResult.body.items[0];
            return {
                status: 200,
                headers: metadata.headers,
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

function coerceTid(tidString) {
    if (uuid.test(tidString)) {
        return tidString;
    }

    // Out of luck
    throw new HTTPError({
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
        throw new HTTPError({
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

ChunkedBucket.prototype._getMetadata = function(restbase, req) {
    var rp = req.params;
    var metadataReq = {
        uri: new URI([rp.domain, 'sys', 'table', this._metaTableName(req), '']),
        body: {
            table: this._metaTableName(req),
            attributes: {
                key: rp.key
            },
            limit: 1
        }
    };
    if (rp.revision) {
        metadataReq.body.attributes.rev = parseRevision(rp.revision);
        if (rp.tid) {
            metadataReq.body.attributes.tid = coerceTid(rp.tid);
        }
    }
    return restbase.get(metadataReq)
    .then(function(metadataRes) {
        return metadataRes.body.items[0];
    });
};

ChunkedBucket.prototype.getRevision = function(restbase, req) {
    var rp = req.params;
    var self = this;
    return this._getMetadata(restbase, req)
    .then(function(metadata) {
        return P.all(range(metadata.num).map(function(chunkId) {
            return restbase.get({
                uri: new URI([rp.domain, 'sys', 'table', self._chunksTableName(req), '']),
                body: {
                    table: self._chunksTableName(req),
                    attributes: {
                        key: rp.key,
                        chunk_id: chunkId,
                        tid: {
                            le: metadata.tid
                        }
                    },
                    limit: 1
                }
            });
        }))
        .map(function(res) { return res.body.items[0].value; })
        .then(function(sections) {
            metadata.value = self._joinData(sections);
            return {
                status: 200,
                body: {
                    items: [ metadata ]
                }
            };
        })
        .then(returnRevision(req, metadata));
    });
};

function getLimit(restbase, req) {
    if (req.body && req.body.limit) {
        return req.body.limit;
    } else if (req.query && req.query.limit) {
        return req.query.limit;
    }
    return restbase.rb_config.default_page_size;
}

ChunkedBucket.prototype.listRevisions = function(restbase, req) {
    var rp = req.params;
    return restbase.get({
        uri: new URI([rp.domain, 'sys', 'table', this._metaTableName(req), '']),
        body: {
            table: this._metaTableName(req),
            attributes: {
                key: req.params.key
            },
            proj: ['rev', 'tid'],
            limit: getLimit(restbase, req)
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

ChunkedBucket.prototype._retentionPolicyUpdate = function(restbase, req, key, rev, tid) {
    var self = this;
    return restbase.get({
        uri: new URI([req.params.domain, 'sys', 'table', self._metaTableName(req), '']),
        body: {
            table: self._metaTableName(req),
            attributes: {
                key: key,
                rev: rev,
                tid: { lt: tid }
            },
            limit: 4,
            _withTTL: true
        }
    })
    .catch({ status: 404 }, function() {
        // Nothing to update, ignore
    })
    .then(function(res) {
        var rows = res && res.body && res.body.items;
        if (rows && rows.length) {
            var toRemove = rows.filter(function(row) { return !row._ttl; });
            return P.each(toRemove, function(row) {
                return restbase.put({
                    uri: new URI([req.params.domain, 'sys', 'table', self._metaTableName(req), '']),
                    body: {
                        table: self._metaTableName(req),
                        attributes: Object.assign({}, row, { _ttl: GRACE_TTL })
                    }
                })
                .then(function() {
                    return P.all(range(row.num).map(function(chunkId) {
                        return restbase.get({
                            uri: new URI([req.params.domain, 'sys', 'table',
                                self._chunksTableName(req), '']),
                            body: {
                                table: self._chunksTableName(req),
                                attributes: {
                                    key: key,
                                    chunk_id: chunkId,
                                    tid: row.tid
                                }
                            }
                        })
                        .then(function(res) {
                            var value = res.body.items[0];
                            return restbase.put({
                                uri: new URI([req.params.domain, 'sys', 'table',
                                    self._chunksTableName(req), '']),
                                body: {
                                    table: self._chunksTableName(req),
                                    attributes: Object.assign(value, { _ttl: GRACE_TTL })
                                }
                            });
                        });
                    }));
                });
            });
        }
    });
};

ChunkedBucket.prototype.putRevision = function(restbase, req) {
    var rp = req.params;
    var self = this;
    var rev = parseRevision(rp.revision);
    var tid = rp.tid && coerceTid(rp.tid) || uuid.now().toString();
    if (req.headers['last-modified']) {
        // XXX: require elevated rights for passing in the revision time
        tid = mwUtil.tidFromDate(req.headers['last-modified']);
    }

    var chunks = this._sliceData(req.body);
    return P.all(chunks.map(function(chunk, index) {
        return restbase.put({
            uri: new URI([rp.domain, 'sys', 'table', self._chunksTableName(req), '']),
            body: {
                table: self._chunksTableName(req),
                attributes: {
                    key: rp.key,
                    chunk_id: index,
                    tid: tid,
                    value: chunk
                }
            }
        });
    }))
    .then(function() {
        var headers = Object.assign({}, req.headers);
        headers.etag = headers.etag || mwUtil.makeETag(rev, tid);
        return restbase.put({
            uri: new URI([rp.domain, 'sys', 'table', self._metaTableName(req), '']),
            body: {
                table: self._metaTableName(req),
                attributes: {
                    key: rp.key,
                    rev: rev,
                    tid: tid,
                    num: chunks.length,
                    headers: headers
                }
            }
        });
    })
    .then(function(res) {
        if (res.status === 201) {
            // Do the retention policy update
            return self._retentionPolicyUpdate(restbase, req, rp.key, rev, tid)
            .thenReturn({
                status: 201,
                headers: {
                    etag: mwUtil.makeETag(rp.revision, tid)
                },
                body: {
                    message: "Created.",
                    tid: rp.revision
                }
            });
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
    var chunkedBucket = new ChunkedBucket(options);

    return {
        spec: spec, // Re-export from spec module
        operations: {
            createBucket: chunkedBucket.createBucket.bind(chunkedBucket),
            listRevisions: chunkedBucket.listRevisions.bind(chunkedBucket),
            getRevision: chunkedBucket.getRevision.bind(chunkedBucket),
            putRevision: chunkedBucket.putRevision.bind(chunkedBucket)
        }
    };
};
