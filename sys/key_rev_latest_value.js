"use strict";

const zlib = require('zlib');
const P = require('bluebird');
const uuid = require('cassandra-uuid').TimeUuid;

const HyperSwitch = require('hyperswitch');
const URI = HyperSwitch.URI;

const mwUtil = require('../lib/mwUtil');

const spec = HyperSwitch.utils.loadSpec(`${__dirname}/key_rev_value.yaml`);

function requestURI(rp, bucket) {
    const requestPath = [rp.domain, 'sys', 'key_rev_value', bucket, rp.key];
    if (rp.revision) {
        requestPath.push(`${rp.revision}`);
        if (rp.tid) {
            requestPath.push(rp.tid);
        }
    }
    return new URI(requestPath);
}

class ArchivalBucket {
    createBucket(hyper, req) {
        const rp = req.params;
        const latestConfig = Object.assign({}, req.body, {
            revisionRetentionPolicy: { type: 'latest_hash' }
        });
        latestConfig.options = latestConfig.options || {};
        latestConfig.options.compression = [];
        latestConfig.valueType = 'blob';

        return P.join(
            hyper.put({
                uri: new URI([rp.domain, 'sys', 'key_rev_value', this._latestName(rp.bucket)]),
                headers: req.headers,
                body: latestConfig
            }),
            hyper.put({
                uri: new URI([rp.domain, 'sys', 'key_rev_value', this._archiveName(rp.bucket)]),
                headers: req.headers,
                body: req.body
            })
        )
        .then(() => ({
            status: 201
        }));
    }

    getRevision(hyper, req) {
        const rp = req.params;
        return hyper.get({
            uri: requestURI(rp, this._latestName(rp.bucket)),
            headers: req.headers
        })
        .then((res) => {
            res.headers['content-encoding'] = 'gzip';
            if (/^application\/json/.test(res.headers['content-type'])) {
                return mwUtil.decodeBody(res)
                .then((res) => {
                    res.body = JSON.parse(res.body);
                    return res;
                });
            }
            return res;
        })
        .catch({ status: 404 }, () => hyper.get({
            uri: requestURI(rp, this._archiveName(rp.bucket)),
            headers: req.headers
        }));
    }

    listRevisions(hyper, req) {
        const rp = req.params;
        return hyper.get({
            uri: new URI([rp.domain, 'sys', 'key_rev_value',
                this._archiveName(rp.bucket), rp.key, '']),
            query: req.query
        });
    }

    putRevision(hyper, req) {
        const rp = req.params;
        rp.tid = rp.tid || uuid.now().toString();
        if (/^application\/json/.test(req.headers['content-type'])) {
            req.body = JSON.stringify(req.body);
        }

        // Custom impl for 0.10 compatibility.
        // When we drop it following lines can be replaced with
        // a promisified convenience method
        const gzip = zlib.createGzip({ level: 6 });
        const prepare = new P((resolve, reject) => {
            const chunks = [];
            gzip.on('data', (chunk) => {
                chunks.push(chunk);
            });
            gzip.on('end', () => {
                resolve(Buffer.concat(chunks));
            });
            gzip.on('error', reject);

            gzip.end(req.body);
        });

        return P.join(
            prepare.then(data => hyper.put({
                uri: requestURI(rp, this._latestName(rp.bucket)),
                headers: req.headers,
                body: data
            })),
            hyper.put({
                uri: requestURI(rp, this._archiveName(rp.bucket)),
                headers: req.headers,
                body: req.body
            })
        )
        .spread(res1 => res1);
    }

    _latestName(bucket) {
        return `${bucket}.latest`;
    }

    _archiveName(bucket) {
        return bucket;
    }
}

module.exports = (options) => {
    const archivalBucket = new ArchivalBucket(options);

    return {
        spec, // Re-export from spec module
        operations: {
            createBucket: archivalBucket.createBucket.bind(archivalBucket),
            listRevisions: archivalBucket.listRevisions.bind(archivalBucket),
            getRevision: archivalBucket.getRevision.bind(archivalBucket),
            putRevision: archivalBucket.putRevision.bind(archivalBucket)
        }
    };
};
