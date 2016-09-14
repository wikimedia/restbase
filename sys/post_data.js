"use strict";

/**
 * Key-value bucket handler
 */

var HyperSwitch = require('hyperswitch');
var crypto = require('crypto');
var stringify = require('json-stable-stringify');
var URI = HyperSwitch.URI;

var spec = HyperSwitch.utils.loadSpec(__dirname + '/post_data.yaml');

function PostDataBucket() {
}

PostDataBucket.prototype.createBucket = function(hyper, req) {
    var rp = req.params;
    return hyper.put({
        uri: new URI([rp.domain, 'sys', 'key_value', rp.bucket]),
        body: {
            keyType: 'string',
            valueType: 'json'
        }
    });
};

PostDataBucket.prototype.getRevision = function(hyper, req) {
    var rp = req.params;
    var path = [rp.domain, 'sys', 'key_value', rp.bucket, rp.key];
    if (rp.tid) {
        path.push(rp.tid);
    }
    return hyper.get({
        uri: new URI(path),
        headers: {
            'cache-control': req.headers && req.headers['cache-control']
        }
    });
};

function calculateHash(storedData) {
    return crypto.createHash('sha1')
                 .update(stringify(storedData))
                 .digest('hex');
}

PostDataBucket.prototype.calculateHash = function(hyper, req) {
    return {
        status: 200,
        headers: {
            'content-type': 'text/plain'
        },
        body: calculateHash(req.body || {})
    };
};

PostDataBucket.prototype.putRevision = function(hyper, req) {
    var rp = req.params;
    var storedData = req.body || {};
    var key = calculateHash(storedData);
    req.params.key = key;
    return this.getRevision(hyper, req)
    .then(function() {
        return {
            status: 200,
            headers: {
                'content-type': 'text/plain'
            },
            body: key
        };
    })
    .catch({ status: 404 }, function() {
        return hyper.put({
            uri: new URI([rp.domain, 'sys', 'key_value', rp.bucket, key]),
            headers: {
                'content-type': 'application/json',
            },
            body: storedData
        })
        .then(function(res) {
            return {
                status: res.status,
                headers: {
                    'content-type': 'text/plain'
                },
                body: key
            };
        });
    });

};

module.exports = function(options) {
    var postDataBucket = new PostDataBucket(options);

    return {
        spec: spec, // Re-export from spec module
        operations: {
            createBucket: postDataBucket.createBucket.bind(postDataBucket),
            getRevision: postDataBucket.getRevision.bind(postDataBucket),
            putRevision: postDataBucket.putRevision.bind(postDataBucket),
            calculateHash: postDataBucket.calculateHash.bind(postDataBucket)
        }
    };
};
