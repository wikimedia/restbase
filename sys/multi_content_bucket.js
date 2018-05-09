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
const spec = HyperSwitch.utils.loadSpec(`${__dirname}/multi_content_bucket.yaml`);

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

class MultiContentBucket {
    constructor(options) {
        this.options = options;

        if (!options.table_name_prefix) {
            throw new Error('table_name_prefix prefix must be provided');
        }
        if (!options.main_content_type) {
            throw new Error('Main content type must be specified');
        }
        if (!options.main_content_type.name) {
            throw new Error('Main content type must specify the name');
        }
        if (!options.main_content_type.value_type) {
            throw new Error('Main content type must specify the value_type');
        }
        if (!options.dependent_content_types || !Array.isArray(options.dependent_content_types)) {
            throw new Error('Dependent content types must be specified');
        }
        options.dependent_content_types.forEach((cTypeSpec) => {
            if (!cTypeSpec.name) {
                throw new Error('Dependent content type must specify name');
            }
            if (!cTypeSpec.value_type) {
                throw new Error(`Dependent content ${cTypeSpec.name} must specify value_type`);
            }
        });

        this.options.grace_ttl = this.options.grace_ttl || 86400;
        this.options.index_ttl = this.options.index_ttl || this.options.grace_ttl * 10;
        this.options.delete_probability = this.options.delete_probability || 1;
    }

    _createContentStoreRequests(hyper, req, rev, tid) {
        const rp = req.params;
        const mainCTypeName = this.options.main_content_type.name;
        const prefix = this.options.table_name_prefix;
        return P.join(this.options.dependent_content_types
        .map(cTypeSpec => hyper.put({
            uri: new URI([rp.domain, 'sys', 'table', `${prefix}.${cTypeSpec.name}`, '']),
            body: {
                table: `${prefix}.${cTypeSpec.name}`,
                attributes: {
                    key: rp.key,
                    rev,
                    tid,
                    'content-type': req.body[cTypeSpec.name].headers['content-type'],
                    value: req.body[cTypeSpec.name].body
                }
            }
        })))
        // Save main content last, so that any error in metadata storage suppresses main content.
        .then(() => hyper.put({
            uri: new URI([rp.domain, 'sys', 'table', `${prefix}.${mainCTypeName}`, '']),
            body: {
                table: `${prefix}.${mainCTypeName}`,
                attributes: {
                    key: rp.key,
                    rev,
                    tid,
                    'content-type': req.body[mainCTypeName].headers['content-type'],
                    value: req.body[mainCTypeName].body
                }
            }
        }));
    }

    _deleteRenders(hyper, req, rev, tid) {
        const rp = req.params;
        const prefix = this.options.table_name_prefix;
        function deleteRender(contentType) {
            return hyper.delete({
                uri: new URI([rp.domain, 'sys', 'table', `${prefix}.${contentType}`, '']),
                body: {
                    table: `${prefix}.${contentType}`,
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

        return deleteRender(this.options.main_content_type.name)
        .then(() => P.all(this.options.dependent_content_types
            .map(cTypeSpec => deleteRender(cTypeSpec.name))));
    }

    _deleteRevisions(hyper, req, rev) {
        const rp = req.params;
        const prefix = this.options.table_name_prefix;
        function deleteRevision(contentType) {
            return hyper.delete({
                uri: new URI([rp.domain, 'sys', 'table', `${prefix}.${contentType}`, '']),
                body: {
                    table: `${prefix}.${contentType}`,
                    attributes: {
                        key: rp.key,
                        rev: {
                            le: rev
                        }
                    }
                }
            });
        }

        return deleteRevision(this.options.main_content_type.name)
        .then(() => P.all(this.options.dependent_content_types
        .map(cTypeSpec => deleteRevision(cTypeSpec.name))));
    }


    createBucket(hyper, req) {
        const rp = req.params;
        const prefix = this.options.table_name_prefix;

        const createRequests = this.options.dependent_content_types
        .concat([this.options.main_content_type])
        .map(cTypeSpec => ({
            uri: new URI([rp.domain, 'sys', 'table', `${prefix}.${cTypeSpec.name}`]),
            body: this.makeSchema({
                valueType: cTypeSpec.value_type,
                table: `${prefix}.${cTypeSpec.name}`
            })
        }))
        .concat([
            {
                uri: new URI([rp.domain, 'sys', 'table', `${prefix}-revision-timeline`]),
                body: {
                    table: `${prefix}-revision-timeline`,
                    version: 2,
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
                        default_time_to_live: this.options.index_ttl
                    }
                }
            },
            {
                uri: new URI([rp.domain, 'sys', 'table', `${prefix}-render-timeline`]),
                body: {
                    table: `${prefix}-render-timeline`,
                    version: 2,
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
                        default_time_to_live: this.options.index_ttl
                    }
                }
            }
        ]);

        // Execute store requests strictly sequentially. Concurrent schema
        // changes are not supported in Cassandra.
        return P.each(createRequests, storeReq => hyper.put(storeReq))
        .thenReturn({ status: 201 });
    }

    makeSchema(opts) {
        const schemaVersionMajor = 3;

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
        const tablePrefix = this.options.table_name_prefix;
        const storeReq = {
            uri: new URI([rp.domain, 'sys', 'table', `${tablePrefix}.${rp.content}`, '']),
            body: {
                table: `${tablePrefix}.${rp.content}`,
                attributes: {
                    key: rp.key
                },
                limit: 1
            }
        };
        if (rp.revision) {
            storeReq.body.attributes.rev = mwUtil.parseRevision(rp.revision, 'multi_content');
            if (rp.tid) {
                storeReq.body.attributes.tid = mwUtil.coerceTid(rp.tid, 'multi_content');
            }
        }

        let indexCheck = P.resolve();
        if (rp.content === this.options.main_content_type.name
                && rp.revision
                && this.options.renew_expiring) {
            // If it's the primary content - check whether it's about to expire
            indexCheck = hyper.get({
                uri: new URI([rp.domain, 'sys', 'table', `${tablePrefix}-revision-timeline`, '']),
                body: {
                    table: `${tablePrefix}-revision-timeline`,
                    attributes: {
                        key: rp.key,
                        ts: {
                            le: new Date(Date.now() - this.options.grace_ttl * 1000 / 2)
                        }
                    },
                    limit: 1
                }
            })
            .then((res) => {
                if (res && res.body.items.length && res.body.items[0].rev >= rp.revision) {
                    throw new HTTPError({
                        status: 404
                    });
                }
            }, (e) => {
                if (e.status !== 404) {
                    throw e;
                }
            });
        }
        return P.props({
            content: hyper.get(storeReq),
            indexCheck
        })
        .get('content')
        .then(returnRevision(req));
    }

    putRevision(hyper, req) {
        const rp = req.params;
        const rev = mwUtil.parseRevision(rp.revision, 'multi_content');
        const tid = rp.tid && mwUtil.coerceTid(rp.tid, 'multi_content') || uuid.now().toString();
        const tablePrefix = this.options.table_name_prefix;
        const mainContentTable = `${tablePrefix}.${this.options.main_content_type.name}`;
        // First, find out what was the previous revision stored to know what we are replacing
        return hyper.get({
            uri: new URI([rp.domain, 'sys', 'table', mainContentTable, '']),
            body: {
                table: mainContentTable,
                attributes: {
                    key: rp.key
                },
                limit: 1,
                proj: [ 'rev', 'tid']
            }
        }).catchReturn({ status: 404 }, undefined)
        .then((res) => {
            if (!res || !res.body.items.length) {
                // Nothing was ever there - put the first render and no need to update the index
                return this._createContentStoreRequests(hyper, req,rev, tid);
            } else if (res && res.body.items.length && res.body.items[0].rev < rev) {
                // New revision is being written - update revision index and do the revision deletes
                const replacedRev = res.body.items[0].rev;
                return this._createContentStoreRequests(hyper, req, rev, tid)
                .tap(() => {
                    // This can be done asyncronously!
                    hyper.put({
                        uri: new URI([rp.domain, 'sys', 'table',
                            `${tablePrefix}-revision-timeline`, '']),
                        body: {
                            table: `${tablePrefix}-revision-timeline`,
                            attributes: {
                                key: rp.key,
                                ts: new Date(),
                                rev: replacedRev
                            }
                        }
                    })
                    .then(() => {
                        if (Math.random() > this.options.delete_probability) {
                            return;
                        }
                        return hyper.get({
                            uri: new URI([rp.domain, 'sys', 'table',
                                `${tablePrefix}-revision-timeline`, '']),
                            body: {
                                table: `${tablePrefix}-revision-timeline`,
                                attributes: {
                                    key: rp.key,
                                    ts: {
                                        le: new Date(Date.now() - this.options.grace_ttl * 1000)
                                    }
                                },
                                limit: 1
                            }
                        })
                        .then((res) => {
                            if (res.body.items.length) {
                                return this._deleteRevisions(hyper, req, res.body.items[0].rev);
                            }
                        });
                    })
                    .catch({ status: 404 }, () => {
                        // Log the 404 if we don't have the timeline.
                        hyper.logger.log('debug/noindex', {
                            msg: 'Empty revision timeline',
                            page_title: rp.key
                        });
                    });
                });
            } else if (res && res.body.items.length && res.body.items[0].rev === rev) {
                // New render is being written - update render index and do the render deletes
                const replacedTid = res.body.items[0].tid;
                return this._createContentStoreRequests(hyper, req, rev, tid)
                .tap(() => {
                    // This can be done asyncronously!
                    hyper.put({
                        uri: new URI([rp.domain, 'sys', 'table',
                            `${tablePrefix}-render-timeline`, '']),
                        body: {
                            table: `${tablePrefix}-render-timeline`,
                            attributes: {
                                key: rp.key,
                                ts: new Date(),
                                rev,
                                tid: replacedTid
                            }
                        }
                    })
                    .then(() => {
                        if (Math.random() > this.options.delete_probability) {
                            return;
                        }
                        return hyper.get({
                            uri: new URI([rp.domain, 'sys', 'table',
                                `${tablePrefix}-render-timeline`, '']),
                            body: {
                                table: `${tablePrefix}-render-timeline`,
                                attributes: {
                                    key: rp.key,
                                    rev,
                                    ts: {
                                        le: new Date(Date.now() - this.options.grace_ttl * 1000)
                                    }
                                },
                                limit: 1
                            }
                        })
                        .then((res) => {
                            if (res.body.items.length) {
                                return this._deleteRenders(hyper, req, rev, res.body.items[0].tid);
                            }
                        });
                    })
                    .catch({ status: 404 }, () => {
                        // Log the 404 if we don't have the timeline.
                        hyper.logger.log('debug/noindex', {
                            msg: 'Empty render timeline',
                            page_title: rp.key,
                            page_revision: rev
                        });
                    });
                });
            } else if (res && res.body.items.length && res.body.items[0].rev > rev) {
                throw new HTTPError({ status: 412 });
            }
        });
    }

    listRevisions(hyper, req) {
        const rp = req.params;
        const tableName = `${this.options.table_name_prefix}.${rp.content}`;
        return hyper.get({
            uri: new URI([rp.domain, 'sys', 'table', tableName, '']),
            body: {
                table: tableName,
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
    const mkBucket = new MultiContentBucket(options);

    return {
        spec, // Re-export from spec module
        operations: {
            createBucket: mkBucket.createBucket.bind(mkBucket),
            getRevision: mkBucket.getRevision.bind(mkBucket),
            putRevision: mkBucket.putRevision.bind(mkBucket),
            listRevisions: mkBucket.listRevisions.bind(mkBucket),
        }
    };
};
