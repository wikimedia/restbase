"use strict";

/**
 * Key-rev-value bucket handler
 */

const P = require('bluebird');
const uuid = require('cassandra-uuid').TimeUuid;
const mwUtil = require('../lib/mwUtil');
const HyperSwitch = require('hyperswitch');
const HTTPError = HyperSwitch.HTTPError;
const URI = HyperSwitch.URI;
const spec = HyperSwitch.utils.loadSpec(`${__dirname}/parsoid_bucket.yaml`);

// Format a revision response. Shared between different ways to retrieve a
// revision (latest & with explicit revision).
function returnRevision(req) {
    return (dbResult) => {
        if (dbResult.body && dbResult.body.items && dbResult.body.items.length) {
            const row = dbResult.body.items[0];
            const headers = {
                etag: mwUtil.makeETag(row.rev, row.tid),
                'content-type': row['content-type']
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

class ParsoidBucket {
    createBucket(hyper, req) {
        const rp = req.params;
        return P.all([
            hyper.put({
                uri: new URI([rp.domain, 'sys', 'table-ng', 'html-ng']),
                body: this.makeSchema({
                    valueType: 'blob',
                    table: 'html-ng'
                })
            }),
            hyper.put({
                uri: new URI([rp.domain, 'sys', 'table-ng', 'data-parsoid-ng']),
                body: this.makeSchema({
                    valueType: 'json',
                    table: 'data-parsoid-ng'
                })
            }),
            hyper.put({
                uri: new URI([rp.domain, 'sys', 'table-ng', 'section-offsets-ng']),
                body: this.makeSchema({
                    valueType: 'json',
                    table: 'section-offsets-ng'
                })

            }),
            hyper.put({
                uri: new URI([rp.domain, 'sys', 'table-ng', 'revision-index']),
                body: {
                    table: 'revision-index',
                    version: 1,
                    attributes: {
                        key: 'string',
                        tid: 'timeuuid',
                        rev: 'int'
                    },
                    index: [
                        { attribute: 'key', type: 'hash' },
                        { attribute: 'tid', type: 'range', order: 'desc' },
                    ]
                }
            })
        ]).thenReturn({ status: 201 });
    }

    makeSchema(opts) {
        const schemaVersionMajor = 2;

        return {
            table: opts.table,
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
                rev: 'int',
                tid: 'timeuuid',
                value: opts.valueType || 'blob',
                // Redirect
                'content-location': 'string',
                'content-type': 'string',
                tags: 'set<string>'
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
            uri: new URI([rp.domain, 'sys', 'table-ng', `${rp.bucket}-ng`, '']),
            body: {
                table: `${rp.bucket}-ng`,
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

    putRevision(hyper, req) {
        const rp = req.params;
        const rev = mwUtil.parseRevision(rp.revision, 'key_rev_value');
        const tid = rp.tid && mwUtil.coerceTid(rp.tid, 'key_rev_value') || uuid.now().toString();

        return P.join(
            hyper.put({
                uri: new URI([rp.domain, 'sys', 'table-ng', 'data-parsoid-ng', '']),
                body: {
                    table: 'data-parsoid-ng',
                    attributes: {
                        key: rp.key,
                        rev,
                        tid,
                        'content-type': req.body['data-parsoid'].headers['content-type'],
                        value: req.body['data-parsoid'].body
                    }
                }
            }),
            hyper.put({
                uri: new URI([rp.domain, 'sys', 'table-ng', 'section-offsets-ng', '']),
                body: {
                    table: 'section-offsets-ng',
                    attributes: {
                        key: rp.key,
                        rev,
                        tid,
                        'content-type': req.body['section-offsets'].headers['content-type'],
                        value: req.body['section-offsets'].body
                    }
                }
            })
        )
        // Save HTML last, so that any error in metadata storage suppresses HTML.
        .then(() =>  hyper.put({
            uri: new URI([rp.domain, 'sys', 'table-ng', 'html-ng', '']),
            body: {
                table: 'html-ng',
                attributes: {
                    key: rp.key,
                    rev,
                    tid,
                    'content-type': req.body.html.headers['content-type'],
                    value: req.body.html.body
                }
            }

        }));
    }

    listRevisions(hyper, req) {
        const rp = req.params;
        return hyper.get({
            uri: new URI([rp.domain, 'sys', 'table-ng', `${rp.bucket}-ng`, '']),
            body: {
                table: `${rp.bucket}-ng`,
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

}

module.exports = (options) => {
    const krvBucket = new ParsoidBucket(options);

    return {
        spec, // Re-export from spec module
        operations: {
            createBucket: krvBucket.createBucket.bind(krvBucket),
            getRevision: krvBucket.getRevision.bind(krvBucket),
            putRevision: krvBucket.putRevision.bind(krvBucket),
            listRevisions: krvBucket.listRevisions.bind(krvBucket),
        }
    };
};
