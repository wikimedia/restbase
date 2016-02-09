"use strict";

var P = require('bluebird');
var uuid = require('cassandra-uuid').TimeUuid;
var preq = require('preq');
var stream = require('stream');

var HyperSwitch = require('hyperswitch');
var HTTPError = HyperSwitch.HTTPError;
var URI = HyperSwitch.URI;

var mwUtil = require('../lib/mwUtil');

var spec = HyperSwitch.utils.loadSpec(__dirname + '/key_rev_value.yaml');

/**
 * The chunk size to use for data slicing
 * @type {number}
 * @const
 */
var CHUNK_SIZE = 1800000;

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
        return dataParts.join('');
    }
};

ChunkedBucket.prototype._metaTableName = function(req) {
    return req.params.bucket + '_index';
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
                    block_size: 256
                }
            ]
        },
        attributes: {
            key: opts.keyType || 'string',
            rev: 'int',
            tid: 'timeuuid',
            num_chunks: 'int',
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
                    block_size: 256
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

ChunkedBucket.prototype._validateSchemaOptions = function(req) {
    var options = req.body || {};

    if (options.retention_policy) {
        throw new Error('key_rev_large_value does not support revision_policy option');
    }

    if (options.compression) {
        throw new Error('key_rev_large_value does not support compression option');
    }
};

ChunkedBucket.prototype.createBucket = function(hyper, req) {
    this._validateSchemaOptions(req);
    var metaSchema = this._makeMetaSchema(req.body || {});
    var dataSchema = this._makeChunksSchema(req.body || {});
    metaSchema.table = this._metaTableName(req);
    dataSchema.table = this._chunksTableName(req);
    return P.join(
        hyper.put({
            uri: new URI([req.params.domain, 'sys', 'table', metaSchema.table]),
            body: metaSchema
        }),
        hyper.put({
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

ChunkedBucket.prototype._getMetadata = function(hyper, req) {
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
        metadataReq.body.attributes.rev = mwUtil.parseRevision(rp.revision, 'key_rev_large_value');
        if (rp.tid) {
            metadataReq.body.attributes.tid = mwUtil.coerceTid(rp.tid, 'key_rev_large_value');
        }
    }
    return hyper.get(metadataReq)
    .then(function(metadataRes) {
        return metadataRes.body.items[0];
    });
};

ChunkedBucket.prototype.getRevision = function(hyper, req) {
    var rp = req.params;
    var self = this;
    var chunksTable = self._chunksTableName(req);
    var chunkURI = new URI([rp.domain, 'sys', 'table', chunksTable, '']);
    return this._getMetadata(hyper, req)
    .then(function(metadata) {
        var byteStream = new stream.PassThrough();
        P.each(range(metadata.num_chunks), function(chunkId) {
            return hyper.get({
                uri: chunkURI,
                body: {
                    table: chunksTable,
                    attributes: {
                        key: rp.key,
                        chunk_id: chunkId,
                        tid: metadata.tid
                    },
                    limit: 1
                }
            })
            .then(function(res) {
                byteStream.write(res.body.items[0].value);
            });
        })
        .then(function() { return byteStream.end(); });

        return {
            status: 200,
            headers: metadata.headers,
            body: byteStream
        };
    });
};

ChunkedBucket.prototype.listRevisions = function(hyper, req) {
    var rp = req.params;
    return hyper.get({
        uri: new URI([rp.domain, 'sys', 'table', this._metaTableName(req), '']),
        body: {
            table: this._metaTableName(req),
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

ChunkedBucket.prototype._setRowTTLs = function(hyper, req, row) {
    var self = this;
    return hyper.put({
        uri: new URI([req.params.domain, 'sys', 'table', self._metaTableName(req), '']),
        body: {
            table: self._metaTableName(req),
            attributes: Object.assign({}, row, { _ttl: GRACE_TTL })
        }
    })
    .then(function() {
        return P.all(range(row.num_chunks).map(function(chunkId) {
            return hyper.get({
                uri: new URI([req.params.domain, 'sys', 'table',
                    self._chunksTableName(req), '']),
                body: {
                    table: self._chunksTableName(req),
                    attributes: {
                        key: row.key,
                        chunk_id: chunkId,
                        tid: row.tid
                    }
                }
            })
            .then(function(res) {
                var value = res.body.items[0];
                return hyper.put({
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
};

ChunkedBucket.prototype._retentionPolicyUpdate = function(hyper, req, key, rev, tid) {
    var self = this;
    return hyper.get({
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
                return self._setRowTTLs(hyper, req, row);
            });
        }
    });
};

ChunkedBucket.prototype.putRevision = function(hyper, req) {
    var rp = req.params;
    var self = this;
    var rev = mwUtil.parseRevision(rp.revision, 'key_rev_large_value');
    var tid = rp.tid && mwUtil.coerceTid(rp.tid, 'key_rev_large_value') || uuid.now().toString();

    var chunks = this._sliceData(req.body);
    return P.all(chunks.map(function(chunk, index) {
        return hyper.put({
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
        return hyper.put({
            uri: new URI([rp.domain, 'sys', 'table', self._metaTableName(req), '']),
            body: {
                table: self._metaTableName(req),
                attributes: {
                    key: rp.key,
                    rev: rev,
                    tid: tid,
                    num_chunks: chunks.length,
                    headers: headers
                }
            }
        });
    })
    .then(function(res) {
        if (res.status === 201) {
            // Do the retention policy update
            return self._retentionPolicyUpdate(hyper, req, rp.key, rev, tid)
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
        hyper.log('error/krlv/putRevision', error);
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
