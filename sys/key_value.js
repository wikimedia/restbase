'use strict';

/**
 * Key-value bucket handler
 */

const crypto = require('crypto');
const TimeUUID = require('cassandra-uuid').TimeUuid;
const mwUtil = require('../lib/mwUtil');
const HyperSwitch = require('hyperswitch');
const HTTPError = HyperSwitch.HTTPError;
const URI = HyperSwitch.URI;

const spec = HyperSwitch.utils.loadSpec(`${__dirname}/key_value.yaml`);

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
        const schemaVersionMajor = 6;

        return {
            // Combine option & bucket version into a monotonically increasing
            // combined schema version. By multiplying the bucket version by 1000,
            // we increase the chance of catching a reset in the option version.
            version: schemaVersionMajor * 1000 + (opts.version || 0),
            attributes: {
                key: 'string',
                // Both TID and ETAG are added in case we ever want to support
                // CAS using lightweight transactions to support proper
                // conditional HTTP requests with `if-modified-since` or `if-match`
                tid: 'timeuuid',
                etag: 'string',
                headers: 'json',
                value: 'blob'
            },
            index: [
                { attribute: 'key', type: 'hash' }
            ]
        };
    }

    getRevision(hyper, req) {
        if (mwUtil.isNoCacheRequest(req)) {
            throw new HTTPError({
                status: 404,
                body: {
                    type: 'not_found',
                    description: 'Not attempting to fetch content for no-cache request'
                }
            });
        }

        const rp = req.params;
        const storeReq = {
            uri: new URI([rp.domain, 'sys', 'table', rp.bucket, '']),
            body: {
                table: rp.bucket,
                attributes: {
                    key: rp.key
                }
            }
        };
        return hyper.get(storeReq).then((dbResult) => {
            if (dbResult.body && dbResult.body.items && dbResult.body.items.length) {
                const row = dbResult.body.items[0];
                return {
                    status: 200,
                    headers: row.headers,
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
        });
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
                limit: 1000
            }
        };
        return hyper.get(storeRequest)
        .then((res) => ({
            status: 200,
            headers: {
                'content-type': 'application/json'
            },
            body: {
                items: res.body.items.map((row) => row.tid)
            }
        }));
    }

    putRevision(hyper, req) {
        if (mwUtil.isNoStoreRequest(req)) {
            return { status: 202 };
        }

        const rp = req.params;
        req.headers = req.headers || {};

        if (req.headers['content-type'] !== 'application/octet-stream' ||
                !Buffer.isBuffer(req.body)) {
            throw new HTTPError({
                status: 400,
                body: {
                    type: 'bad_request',
                    description: `Got ${req.headers['content-type']}, not octet-stream`,
                    uri: req.uri,
                    method: req.method
                }
            });
        }

        const tid = TimeUUID.now().toString();
        if (!req.headers.etag) {
            hyper.logger.log('fatal/kv/putRevision', {
                msg: 'No etag header provided to key-value bucket'
            });
            req.headers.etag = crypto.createHash('sha256')
                .update(req.body)
                .digest('hex');
        }

        const headersToStore = {};
        Object.keys(req.headers).filter((name) => name.startsWith('x-store-'))
        .forEach((name) => {
            const realName = name.replace('x-store-', '');
            headersToStore[realName] = req.headers[name];
        });

        const doPut = () => hyper.put({
            uri: new URI([rp.domain, 'sys', 'table', rp.bucket, '']),
            body: {
                table: rp.bucket,
                attributes: {
                    key: rp.key,
                    tid,
                    etag: req.headers.etag,
                    headers: headersToStore,
                    value: req.body
                }
            }
        })
        .then((res) => {
            if (res.status === 201) {
                return {
                    status: 201,
                    body: {
                        message: 'Created.'
                    }
                };
            } else {
                throw res;
            }
        })
        .tapCatch((error) => hyper.logger.log('error/kv/putRevision', error));

        // TODO: Respect the stored ETag and allow matching on etag - either one provided
        // by the client or auto-generated one.
        if (req.headers['if-none-hash-match']) {
            delete req.headers['if-none-hash-match'];
            return hyper.get({
                uri: new URI([rp.domain, 'sys', 'key_value', rp.bucket, rp.key])
            })
            .then((oldContent) => {
                if (req.headers.etag === oldContent.headers.etag &&
                        (!headersToStore['content-type'] ||
                        headersToStore['content-type'] === oldContent.headers['content-type'])) {
                    hyper.metrics.increment(`sys_kv_${req.params.bucket}.unchanged_rev_render`);
                    throw new HTTPError({
                        status: 412,
                        body: {
                            type: 'precondition_failed',
                            description: 'Not replacing existing content'
                        }
                    });
                }
                return doPut();
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
