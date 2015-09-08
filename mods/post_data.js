"use strict";

/**
 * Key-value bucket handler
 */

// TODO: move to separate spec package
var yaml = require('js-yaml');
var fs = require('fs');
var spec = yaml.safeLoad(fs.readFileSync(__dirname + '/post_data.yaml'));
var crypto = require('crypto');
var stringify = require('json-stable-stringify');
var URI = require('swagger-router').URI;

function PostDataBucket(options) {
    this.log = options.log || function() {};
}

PostDataBucket.prototype.getBucketInfo = function(restbase, req) {
    var rp = req.params;
    return restbase.get({
        uri: new URI([rp.domain, 'sys', 'key_value', rp.bucket]),
    });
};

PostDataBucket.prototype.createBucket = function(restbase, req) {
    var rp = req.params;
    return restbase.put({
        uri: new URI([rp.domain, 'sys', 'key_value', rp.bucket]),
        body: {
            keyType: 'string',
            valueType: 'json'
        }
    });
};

PostDataBucket.prototype.listBucket = function(restbase, req) {
    var rp = req.params;
    return restbase.get({
        uri: new URI([rp.domain, 'sys', 'key_value', rp.bucket, ''])
    });
};

PostDataBucket.prototype.getRevision = function(restbase, req) {
    var rp = req.params;
    var path = [rp.domain, 'sys', 'key_value', rp.bucket, rp.key];
    if (rp.tid) {
        path.push(rp.tid);
    }
    return restbase.get({
        uri: new URI(path),
        headers: {
            'cache-control': req.headers && req.headers['cache-control']
        }
    });
};

function prepareStoredReq(req) {
    var storedReq = {};
    storedReq.uri = req.body && req.body.uri && req.body.uri.toString();
    storedReq.body = req.body && req.body.body || {};
    return storedReq;
}

function calculateHash(storedData) {
    return crypto.createHash('sha1')
                 .update(stringify(storedData))
                 .digest('hex');
}

PostDataBucket.prototype.putRevision = function(restbase, req) {
    var rp = req.params;
    var storedReq = prepareStoredReq(req);
    var key = calculateHash(storedReq);
    req.params.key = key;
    return this.getRevision(restbase, req)
    .then(function() {
        return {
            status: 200,
            headers: {
                'content-type': 'text/plain'
            },
            body: key
        };
    })
    .catch(function(e) {
        if (e.status === 404) {
            return restbase.put({
                uri: new URI([rp.domain, 'sys', 'key_value', rp.bucket, key]),
                headers: {
                    'content-type': 'application/json',
                },
                body: storedReq
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
        } else {
            throw e;
        }
    });

};

module.exports = function(options) {
    var postDataBucket = new PostDataBucket(options);

    return {
        spec: spec, // Re-export from spec module
        operations: {
            getBucketInfo: postDataBucket.getBucketInfo.bind(postDataBucket),
            createBucket: postDataBucket.createBucket.bind(postDataBucket),
            listBucket: postDataBucket.listBucket.bind(postDataBucket),
            getRevision: postDataBucket.getRevision.bind(postDataBucket),
            putRevision: postDataBucket.putRevision.bind(postDataBucket)
        }
    };
};