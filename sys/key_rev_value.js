"use strict";

/**
 * Key-rev-value bucket handler
 */

const uuid = require('cassandra-uuid').TimeUuid;
const mwUtil = require('../lib/mwUtil');
const HyperSwitch = require('hyperswitch');
const HTTPError = HyperSwitch.HTTPError;
const URI = HyperSwitch.URI;
const spec = HyperSwitch.utils.loadSpec(`${__dirname}/key_rev_value.yaml`);

// Format a revision response. Shared between different ways to retrieve a
// revision (latest & with explicit revision).
function returnRevision(req) {
    return (dbResult) => {
        if (dbResult.body && dbResult.body.items && dbResult.body.items.length) {
            const row = dbResult.body.items[0];
            const headers = {
                etag: mwUtil.makeETag(row.rev, row.tid),
                'content-type': row.headers['content-type'] || 'application/octet-stream'
            };
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

class KRVBucket {
    createBucket(hyper, req) {
        const schema = this.makeSchema(req.body || {});
        schema.table = req.params.bucket;
        const rp = req.params;
        const storeRequest = {
            uri: new URI([rp.domain, 'sys', 'table3', rp.bucket]),
            body: schema
        };
        return hyper.put(storeRequest);
    }

    makeSchema(opts) {
        const schemaVersionMajor = 1;

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
                default_time_to_live: opts.default_time_to_live
            },
            attributes: {
                key: opts.keyType || 'string',
                rev: 'int',
                tid: 'timeuuid',
                value: opts.valueType || 'blob',
                headers: 'json'
            },
            index: [
                { attribute: 'key', type: 'hash' },
                { attribute: 'rev', type: 'range', order: 'desc' },
                { attribute: 'tid', type: 'range', order: 'desc' }
            ]
        };
    }

    getRevision(hyper, req) {
        const rp = req.params;
        const storeReq = {
            uri: new URI([rp.domain, 'sys', 'table3', rp.bucket, '']),
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
    }

    listRevisions(hyper, req) {
        const rp = req.params;
        return hyper.get({
            uri: new URI([rp.domain, 'sys', 'table3', rp.bucket, '']),
            body: {
                table: req.params.bucket,
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


    putRevision(hyper, req) {
        const rp = req.params;
        const rev = mwUtil.parseRevision(rp.revision, 'key_rev_value');

        const tid = rp.tid && mwUtil.coerceTid(rp.tid, 'key_rev_value')
            || uuid.now().toString();
        return hyper.put({
            uri: new URI([rp.domain, 'sys', 'table3', rp.bucket, '']),
            body: {
                table: rp.bucket,
                attributes: {
                    key: rp.key,
                    rev,
                    tid,
                    value: req.body,
                    headers: req.headers
                }
            }
        })
        .then((res) => {
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
        }, (error) => {
            hyper.log('error/krv/putRevision', error);
            return { status: 400 };
        });
    }
}

module.exports = (options) => {
    const krvBucket = new KRVBucket(options);

    return {
        spec, // Re-export from spec module
        operations: {
            createBucket: krvBucket.createBucket.bind(krvBucket),
            listRevisions: krvBucket.listRevisions.bind(krvBucket),
            getRevision: krvBucket.getRevision.bind(krvBucket),
            putRevision: krvBucket.putRevision.bind(krvBucket)
        }
    };
};
