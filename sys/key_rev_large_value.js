"use strict";

const P = require('bluebird');
const uuid = require('cassandra-uuid').TimeUuid;

const HyperSwitch = require('hyperswitch');
const HTTPError = HyperSwitch.HTTPError;
const URI = HyperSwitch.URI;

const mwUtil = require('../lib/mwUtil');

const spec = HyperSwitch.utils.loadSpec(`${__dirname}/key_rev_value.yaml`);

/**
 * The chunk size to use for data slicing
 * @type {number}
 * @const
 */
const CHUNK_SIZE = 31000;

/**
 * The grace_ttl parameter for a revision policy
 * @type {number}
 * @const
 */
const GRACE_TTL = 86400;

function range(N) {
    return Array.apply(null, { length: N }).map(Number.call, Number);
}

function _sliceData(data)  {
    let slicer;
    if (Buffer.isBuffer(data)) {
        slicer = Buffer.prototype.slice;
    } else {
        data = data.toString();
        slicer = String.prototype.substring;
    }
    const result = [];
    for (let index = 0; index < data.length; index += CHUNK_SIZE) {
        result.push(slicer.call(data, index, index + CHUNK_SIZE));
    }
    return result;
}

function _joinData(dataParts) {
    if (!dataParts || !dataParts.length) {
        return '';
    } else if (Buffer.isBuffer(dataParts[0])) {
        return Buffer.concat(dataParts);
    } else {
        return dataParts.join('');
    }
}

function _validateSchemaOptions(req) {
    const options = req.body || {};

    if (options.retention_policy) {
        throw new Error('key_rev_large_value does not support revision_policy option');
    }

    if (options.compression) {
        throw new Error('key_rev_large_value does not support compression option');
    }
}

// Format a revision response. Shared between different ways to retrieve a
// revision (latest & with explicit revision).
function returnRevision(req, metadata) {
    return (dbResult) => {
        if (dbResult.body && dbResult.body.items && dbResult.body.items.length) {
            const row = dbResult.body.items[0];
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

class ChunkedBucket {
    constructor(options) {
        this.log = options.log || (() => {});
    }

    createBucket(hyper, req) {
        _validateSchemaOptions(req);
        const metaSchema = this._makeMetaSchema(req.body || {});
        const dataSchema = this._makeChunksSchema(req.body || {});
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
        .then(() => ({
            status: 201
        }));
    }

    _getMetadata(hyper, req) {
        const rp = req.params;
        const metadataReq = {
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
            metadataReq.body.attributes.rev
                = mwUtil.parseRevision(rp.revision, 'key_rev_large_value');
            if (rp.tid) {
                metadataReq.body.attributes.tid = mwUtil.coerceTid(rp.tid, 'key_rev_large_value');
            }
        }
        return hyper.get(metadataReq)
        .then(metadataRes => metadataRes.body.items[0]);
    }

    getRevision(hyper, req) {
        const rp = req.params;
        return this._getMetadata(hyper, req)
        .then(metadata => P.all(range(metadata.num_chunks).map(chunkId => hyper.get({
            uri: new URI([rp.domain, 'sys', 'table', this._chunksTableName(req), '']),
            body: {
                table: this._chunksTableName(req),
                attributes: {
                    key: rp.key,
                    chunk_id: chunkId,
                    tid: metadata.tid
                },
                limit: 1
            }
        })))
        .map(res => res.body.items[0].value)
        .then((sections) => {
            metadata.value = _joinData(sections);
            return {
                status: 200,
                body: {
                    items: [ metadata ]
                }
            };
        })
        .then(returnRevision(req, metadata)));
    }

    listRevisions(hyper, req) {
        const rp = req.params;
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
        .then(res => ({
            status: 200,

            headers: {
                'content-type': 'application/json'
            },

            body: {
                items: res.body.items.map(row => ({
                    revision: row.rev,
                    tid: row.tid
                })),
                next: res.body.next
            }
        }));
    }

    _setRowTTLs(hyper, req, row) {
        return hyper.put({
            uri: new URI([req.params.domain, 'sys', 'table', this._metaTableName(req), '']),
            body: {
                table: this._metaTableName(req),
                attributes: Object.assign({}, row, { _ttl: GRACE_TTL })
            }
        })
        .then(() => P.all(range(row.num_chunks).map(chunkId => hyper.get({
            uri: new URI([req.params.domain, 'sys', 'table',
                this._chunksTableName(req), '']),
            body: {
                table: this._chunksTableName(req),
                attributes: {
                    key: row.key,
                    chunk_id: chunkId,
                    tid: row.tid
                }
            }
        })
        .then((res) => {
            const value = res.body.items[0];
            return hyper.put({
                uri: new URI([req.params.domain, 'sys', 'table',
                    this._chunksTableName(req), '']),
                body: {
                    table: this._chunksTableName(req),
                    attributes: Object.assign(value, { _ttl: GRACE_TTL })
                }
            });
        }))));
    }

    _metaTableName(req) {
        return `${req.params.bucket}_index`;
    }

    _chunksTableName(req) {
        return `${req.params.bucket}_chunks`;
    }

    _makeMetaSchema(opts) {
        const schemaVersionMajor = 1;

        return {
            version: schemaVersionMajor * 1000 + (opts.version || 0),
            options: {
                compression: opts.compression || [
                    {
                        algorithm: 'deflate',
                        block_size: 128
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
    }

    _makeChunksSchema(opts) {
        const schemaVersionMajor = 1;

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
    }

    _retentionPolicyUpdate(hyper, req, key, rev, tid) {
        return hyper.get({
            uri: new URI([req.params.domain, 'sys', 'table', this._metaTableName(req), '']),
            body: {
                table: this._metaTableName(req),
                attributes: {
                    key,
                    rev,
                    tid: { lt: tid }
                },
                limit: 4,
                _withTTL: true
            }
        })
        .catch({ status: 404 }, () => {
            // Nothing to update, ignore
        })
        .then((res) => {
            const rows = res && res.body && res.body.items;
            if (rows && rows.length) {
                const toRemove = rows.filter(row => !row._ttl);
                return P.each(toRemove, row => this._setRowTTLs(hyper, req, row));
            }
        });
    }

    putRevision(hyper, req) {
        const rp = req.params;
        const rev = mwUtil.parseRevision(rp.revision, 'key_rev_large_value');
        const tid = rp.tid && mwUtil.coerceTid(rp.tid, 'key_rev_large_value')
            || uuid.now().toString();

        const chunks = _sliceData(req.body);
        return P.all(chunks.map((chunk, index) => hyper.put({
            uri: new URI([rp.domain, 'sys', 'table', this._chunksTableName(req), '']),
            body: {
                table: this._chunksTableName(req),
                attributes: {
                    key: rp.key,
                    chunk_id: index,
                    tid,
                    value: chunk
                }
            }
        })))
        .then(() => {
            const headers = Object.assign({}, req.headers);
            headers.etag = headers.etag || mwUtil.makeETag(rev, tid);
            return hyper.put({
                uri: new URI([rp.domain, 'sys', 'table', this._metaTableName(req), '']),
                body: {
                    table: this._metaTableName(req),
                    attributes: {
                        key: rp.key,
                        rev,
                        tid,
                        num_chunks: chunks.length,
                        headers
                    }
                }
            });
        })
        .then((res) => {
            if (res.status === 201) {
                // Do the retention policy update
                return this._retentionPolicyUpdate(hyper, req, rp.key, rev, tid)
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
        .catch((error) => {
            hyper.log('error/krlv/putRevision', error);
            return { status: 400 };
        });
    }
}

module.exports = (options) => {
    const chunkedBucket = new ChunkedBucket(options);

    return {
        spec, // Re-export from spec module
        operations: {
            createBucket: chunkedBucket.createBucket.bind(chunkedBucket),
            listRevisions: chunkedBucket.listRevisions.bind(chunkedBucket),
            getRevision: chunkedBucket.getRevision.bind(chunkedBucket),
            putRevision: chunkedBucket.putRevision.bind(chunkedBucket)
        }
    };
};
