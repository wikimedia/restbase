'use strict';

/**
 * Key-value bucket handler
 */

const HyperSwitch = require('hyperswitch');
const crypto = require('crypto');
const stringify = require('json-stable-stringify');
const URI = HyperSwitch.URI;

function calculateHash(storedData) {
    return crypto.createHash('sha1').update(stringify(storedData)).digest('hex');
}

class PostDataBucket {
    putRevision(hyper, req) {
        const rp = req.params;
        const storedData = req.body || {};
        const key = calculateHash(storedData);
        req.params.key = key;
        return this.getRevision(hyper, req)
        .then(() => ({
            status: 200,
            headers: {
                'content-type': 'text/plain'
            },
            body: key
        }))
        .catch({ status: 404 }, () => hyper.put({
            uri: new URI([rp.domain, 'sys', 'key_value', rp.bucket, key]),
            headers: {
                'content-type': 'application/json'
            },
            body: storedData
        })
        .then((res) => ({
            status: res.status,
            headers: {
                'content-type': 'text/plain'
            },
            body: key
        })));
    }

    calculateHash(hyper, req) {
        return {
            status: 200,
            headers: {
                'content-type': 'text/plain'
            },
            body: calculateHash(req.body || {})
        };
    }

    createBucket(hyper, req) {
        const rp = req.params;
        return hyper.put({
            uri: new URI([rp.domain, 'sys', 'key_value', rp.bucket]),
            body: {
                keyType: 'string',
                valueType: 'json'
            }
        });
    }

    getRevision(hyper, req) {
        const rp = req.params;
        const path = [rp.domain, 'sys', 'key_value', rp.bucket, rp.key];
        if (rp.tid) {
            path.push(rp.tid);
        }
        return hyper.get({
            uri: new URI(path),
            headers: {
                'cache-control': req.headers && req.headers['cache-control']
            }
        });
    }
}

module.exports = (options) => {
    const postDataBucket = new PostDataBucket(options);
    return {
        spec: HyperSwitch.utils.loadSpec(`${__dirname}/post_data.yaml`),
        operations: {
            createBucket: postDataBucket.createBucket.bind(postDataBucket),
            getRevision: postDataBucket.getRevision.bind(postDataBucket),
            putRevision: postDataBucket.putRevision.bind(postDataBucket),
            calculateHash: postDataBucket.calculateHash.bind(postDataBucket)
        }
    };
};
