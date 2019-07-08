'use strict';

/**
 * Key-value bucket handler
 */

const uuidv1 = require('uuid/v1');
const mwUtil = require('../lib/mwUtil');
const HyperSwitch = require('hyperswitch');
const stringify = require('fast-json-stable-stringify');
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
                }
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

    putRevision(hyper, req) {
        if (mwUtil.isNoStoreRequest(req)) {
            return { status: 202 };
        }
        delete req.headers['cache-control'];

        const rp = req.params;
        const tid = uuidv1();

        // In case specific content-type to store is not provided,
        // default to the request content type. Ideally this should not happen.
        if (req.headers &&
                req.headers['content-type'] &&
                !req.headers['x-store-content-type']) {
            hyper.logger.log('warn/kv', {
                msg: 'No x-store-content-type provided. Defaulting to plain content-type'
            });
            req.headers['x-store-content-type'] = req.headers['content-type'];
        }
        const headersToStore = {};
        Object.keys(req.headers)
        .filter((headerName) => headerName.startsWith('x-store-'))
        .forEach((headerName) => {
            headersToStore[headerName.replace(/^x-store-/, '')] = req.headers[headerName];
        });

        const doPut = () => hyper.put({
            uri: new URI([rp.domain, 'sys', 'table', rp.bucket, '']),
            body: {
                table: rp.bucket,
                attributes: {
                    key: rp.key,
                    tid,
                    headers: headersToStore,
                    value: req.body
                }
            }
        });

        if (req.headers['if-none-hash-match']) {
            delete req.headers['if-none-hash-match'];
            return this.getRevision(hyper, req)
            .then((oldContent) => {
                // TODO: proper etag-based compare.
                if (stringify(req.body) === stringify(oldContent.body) &&
                        (!headersToStore['content-type'] ||
                        headersToStore['content-type'] === oldContent.headers['content-type'])) {
                    hyper.metrics.increment(`sys_kv_${req.params.bucket}.unchanged_rev_render`);
                    return {
                        status: 412,
                        headers: oldContent.headers
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
            getRevision: kvBucket.getRevision.bind(kvBucket),
            putRevision: kvBucket.putRevision.bind(kvBucket)
        }
    };
};
