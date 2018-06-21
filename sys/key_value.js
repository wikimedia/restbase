"use strict";

/**
 * Key-value bucket handler
 */

const uuid = require('cassandra-uuid').TimeUuid;
const mwUtil = require('../lib/mwUtil');
const HyperSwitch = require('hyperswitch');
const stringify = require('json-stable-stringify');
const HTTPError = HyperSwitch.HTTPError;
const URI = HyperSwitch.URI;

const spec = HyperSwitch.utils.loadSpec(`${__dirname}/key_value.yaml`);

// Format a revision response. Shared between different ways to retrieve a
// revision (latest & with explicit revision).
function returnRevision(req) {
    return (dbResult) => {
        if (dbResult.body && dbResult.body.items && dbResult.body.items.length) {
            const row = dbResult.body.items[0];
            let headers = {
                etag: row.headers.etag || mwUtil.makeETag('0', row.tid)
            };
            if (row.headers) {
                headers = Object.assign(headers, row.headers);
            }
            return {
                status: 200,
                headers,
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

class KVBucket {
    createBucket(hyper, req) {
        const schema = this.makeSchema(req.body || {});
        schema.table = req.params.bucket;
        const rp = req.params;
        const storeRequest = {
            uri: new URI([rp.domain, 'sys', 'table', rp.bucket]),
            body: schema
        };
        return hyper.put(storeRequest);
    }

    makeSchema(opts) {
        const schemaVersionMajor = 5;

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
            attributes: {
                key: opts.keyType || 'string',
                tid: 'timeuuid',
                headers: 'json',
                value: opts.valueType || 'blob'
            },
            index: [
                { attribute: 'key', type: 'hash' }
            ]
        };
    }


    getRevision(hyper, req) {
        if (mwUtil.isNoCacheRequest(req)) {
            throw new HTTPError({ status: 404 });
        }

        const rp = req.params;
        const storeReq = {
            uri: new URI([rp.domain, 'sys', 'table', rp.bucket, '']),
            body: {
                table: rp.bucket,
                attributes: {
                    key: rp.key
                },
                limit: 1
            }
        };
        return hyper.get(storeReq).then(returnRevision(req));
    }


    listRevisions(hyper, req) {
        const rp = req.params;
        const storeRequest = {
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
        .then(res => ({
            status: 200,
            headers: {
                'content-type': 'application/json'
            },
            body: {
                items: res.body.items.map(row => row.tid)
            }
        }));
    }


    putRevision(hyper, req) {
        const rp = req.params;
        let tid = rp.tid && mwUtil.coerceTid(rp.tid, 'key_value');

        if (!tid) {
            tid = (mwUtil.parseETag(req.headers && req.headers.etag) || {}).tid;
            tid = tid || uuid.now().toString();
        }

        if (mwUtil.isNoStoreRequest(req)) {
            return {
                status: 202,
                headers: {
                    etag: req.headers && req.headers.etag || mwUtil.makeETag('0', tid)
                }
            };
        }

        const doPut = () => hyper.put({
            uri: new URI([rp.domain, 'sys', 'table', rp.bucket, '']),
            body: {
                table: rp.bucket,
                attributes: {
                    key: rp.key,
                    tid,
                    value: req.body,
                    headers: req.headers,
                }
            }
        })
        .then((res) => {
            if (res.status === 201) {
                return {
                    status: 201,
                    headers: {
                        etag: req.headers && req.headers.etag || mwUtil.makeETag('0', tid)
                    },
                    body: {
                        message: "Created.",
                        tid
                    }
                };
            } else {
                throw res;
            }
        })
        .catch((error) => {
            hyper.logger.log('error/kv/putRevision', error);
            return { status: 400 };
        });

        if (req.headers['if-none-hash-match']) {
            delete req.headers['if-none-hash-match'];
            return hyper.get({
                uri: new URI([rp.domain, 'sys', 'key_value', rp.bucket, rp.key])
            })
            .then((oldContent) => {
                if (stringify(req.body) === stringify(oldContent.body) &&
                        (!req.headers['content-type']
                        || req.headers['content-type'] === oldContent.headers['content-type'])) {
                    hyper.metrics.increment(`sys_kv_${req.params.bucket}.unchanged_rev_render`);
                    return {
                        status: 412,
                        headers: {
                            etag: oldContent.headers.etag
                        }
                    };
                }
                throw new HTTPError({ status: 404 });
            })
            .catch({ status: 404 }, doPut);
        } else {
            return doPut();
        }
    }
}
module.exports = (options) => {
    const kvBucket = new KVBucket(options);

    return {
        spec, // Re-export from spec module
        operations: {
            createBucket: kvBucket.createBucket.bind(kvBucket),
            listRevisions: kvBucket.listRevisions.bind(kvBucket),
            getRevision: kvBucket.getRevision.bind(kvBucket),
            putRevision: kvBucket.putRevision.bind(kvBucket)
        }
    };
};
