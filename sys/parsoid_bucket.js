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

function createContentStoreRequests(hyper, req, rev, tid) {
    const rp = req.params;
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

function deleteRenders(hyper, req, rev, tid) {
    const rp = req.params;

    function deleteRender(contentType) {
        return hyper.delete({ // TODO: Delete other content too
            uri: new URI([rp.domain, 'sys', 'table-ng', `${contentType}-ng`, '']),
            body: {
                table: `${contentType}-ng`,
                attributes: {
                    key: rp.key,
                    rev,
                    tid: {
                        le: tid
                    }
                }
            }
        });
    }

    return deleteRender('html')
    .then(() => P.join(
        deleteRender('data-parsoid'),
        deleteRender('section-offsets'))
    );
}

function deleteRevisions(hyper, req, rev) {
    const rp = req.params;
    function deleteRevision(contentType) {
        return hyper.delete({ // TODO: Delete other content too
            uri: new URI([rp.domain, 'sys', 'table-ng', `${contentType}-ng`, '']),
            body: {
                table: `${contentType}-ng`,
                attributes: {
                    key: rp.key,
                    rev: {
                        le: rev
                    }
                }
            }
        });
    }

    return deleteRevision('html')
    .then(() => P.join(
        deleteRevision('data-parsoid'),
        deleteRevision('section-offsets'))
    );
}

class ParsoidBucket {
    constructor(options) {
        this.options = options;
        this.options.time_to_live = this.options.time_to_live || 86400;
    }

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
            hyper.put({ // TODO: add default TTL
                uri: new URI([rp.domain, 'sys', 'table-ng', 'revision-timeline']),
                body: {
                    table: 'revision-timeline',
                    version: 1,
                    attributes: {
                        key: 'string',
                        ts: 'timestamp',
                        rev: 'int'
                    },
                    index: [
                        { attribute: 'key', type: 'hash' },
                        { attribute: 'ts', type: 'range', order: 'desc' },
                    ],
                    options: {
                        default_time_to_live: this.options.time_to_live * 10
                    }
                }
            }),
            hyper.put({ // TODO: add default TTL
                uri: new URI([rp.domain, 'sys', 'table-ng', 'render-timeline']),
                body: {
                    table: 'render-timeline',
                    version: 1,
                    attributes: {
                        key: 'string',
                        ts: 'timestamp',
                        rev: 'int',
                        tid: 'timeuuid'
                    },
                    index: [
                        { attribute: 'key', type: 'hash' },
                        { attribute: 'rev', type: 'range', order: 'desc' },
                        { attribute: 'ts', type: 'range', order: 'desc' },
                    ],
                    options: {
                        default_time_to_live: this.options.time_to_live * 10
                    }
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
            storeReq.body.attributes.rev = mwUtil.parseRevision(rp.revision, 'parsoid_bucket');
            if (rp.tid) {
                storeReq.body.attributes.tid = mwUtil.coerceTid(rp.tid, 'parsoid_bucket');
            }
        }
        return hyper.get(storeReq).then(returnRevision(req));
    }

    putRevision(hyper, req) {
        const rp = req.params;
        const rev = mwUtil.parseRevision(rp.revision, 'parsoid_bucket');
        const tid = rp.tid && mwUtil.coerceTid(rp.tid, 'parsoid_bucket') || uuid.now().toString();

        // First, find out what was the previous revision stored to know what we are replacing
        return hyper.get({
            uri: new URI([rp.domain, 'sys', 'table-ng', 'html-ng', '']),
            body: {
                table: `html-ng`,
                attributes: {
                    key: rp.key
                },
                limit: 1,
                proj: [ 'rev', 'tid']
            }
        }).catchReturn({ status: 404 }, undefined)
        .then((res) => {
            if (!res || !res.body.items.length) {
                // Noting was ever there - put the first render and no need to update the index
                return createContentStoreRequests(hyper, req,rev, tid);
            } else if (res && res.body.items.length && res.body.items[0].rev < rev) {
                // New revision is being written - update revision index and do the revision deletes
                const replacedRev = res.body.items[0].rev;
                return createContentStoreRequests(hyper, req, rev, tid)
                .tap(() => {
                    // This can be done asyncronously!
                    hyper.put({
                        uri: new URI([rp.domain, 'sys', 'table-ng', 'revision-timeline', '']),
                        body: {
                            table: 'revision-timeline',
                            attributes: {
                                key: rp.key,
                                ts: new Date(),
                                rev: replacedRev
                            }
                        }
                    })
                    .then(() => hyper.get({
                        uri: new URI([rp.domain, 'sys', 'table-ng', 'revision-timeline', '']),
                        body: {
                            table: 'revision-timeline',
                            attributes: {
                                key: rp.key,
                                ts: {
                                    le: new Date(Date.now() - this.options.time_to_live * 1000)
                                }
                            },
                            limit: 1
                        }
                    }))
                    .then((res) => {
                        if (res.body.items.length) {
                            return deleteRevisions(hyper, req, res.body.items[0].rev);
                        }
                    })
                    .catch({ status: 404 }, () => {
                        // Ignore the 404 if we don't have the timeline.
                    });
                });
            } else if (res && res.body.items.length && res.body.items[0].rev === rev) {
                // New render is being written - update render index and do the render deletes
                const replacedTid = res.body.items[0].tid;
                return createContentStoreRequests(hyper, req, rev, tid)
                .tap(() => {
                    // This can be done asyncronously!
                    hyper.put({
                        uri: new URI([rp.domain, 'sys', 'table-ng', 'render-timeline', '']),
                        body: {
                            table: 'render-timeline',
                            attributes: {
                                key: rp.key,
                                ts: new Date(),
                                rev,
                                tid: replacedTid
                            }
                        }
                    })
                    .then(() => hyper.get({
                        uri: new URI([rp.domain, 'sys', 'table-ng', 'render-timeline', '']),
                        body: {
                            table: 'render-timeline',
                            attributes: {
                                key: rp.key,
                                rev,
                                ts: {
                                    le: new Date(Date.now() - this.options.time_to_live * 1000)
                                }
                            },
                            limit: 1
                        }
                    }))
                    .then((res) => {
                        if (res.body.items.length) {
                            return deleteRenders(hyper, req, rev, res.body.items[0].tid);
                        }
                    })
                    .catch({ status: 404 }, () => {
                        // Ignore the 404 if we don't have the timeline.
                    });
                });
            } else if (res && res.body.items.length && res.body.items[0].rev > rev) {
                throw new HTTPError({ status: 412 });
            }
        });
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
