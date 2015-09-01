"use strict";

/**
 * Key-value bucket handler
 */

// TODO: move to separate spec package
var yaml = require('js-yaml');
var fs = require('fs');
var spec = yaml.safeLoad(fs.readFileSync(__dirname + '/post_data.yaml'));
var sha1 = require('sha1');
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
        uri: new URI(path)
    });
};


PostDataBucket.prototype.listRevisions = function(restbase, req) {
    var rp = req.params;
    return restbase.get({
        uri: new URI([rp.domain, 'sys', 'key_value', rp.bucket, ''])
    });
};

function calculateHash(req) {
    // Ensure consistent hashing
    req.headers = req.headers || {};
    req.body = req.body || {};
    req.query = req.query || {};
    req.params = req.params || {};

    // Need to remove x-request-id header if it's present
    var reqId = req.headers['x-request-id'];
    if (reqId) {
        delete req.headers['x-request-id'];
    }

    var result = sha1(stringify(req));

    if (reqId) {
        req.headers['x-request-id'] = reqId;
    }
    return result;
}

PostDataBucket.prototype.putRevision = function(restbase, req) {
    var rp = req.params;
    var key = calculateHash(req);
    return restbase.put({
        uri: new URI([rp.domain, 'sys', 'key_value', rp.bucket, key]),
        headers: {
            'content-type': 'application/json',
            'cache-control': req.headers && req.headers['cache-control']
        },
        body: req
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
};

module.exports = function(options) {
    var postDataBucket = new PostDataBucket(options);

    return {
        spec: spec, // Re-export from spec module
        operations: {
            getBucketInfo: postDataBucket.getBucketInfo.bind(postDataBucket),
            createBucket: postDataBucket.createBucket.bind(postDataBucket),
            listBucket: postDataBucket.listBucket.bind(postDataBucket),
            listRevisions: postDataBucket.listRevisions.bind(postDataBucket),
            getRevision: postDataBucket.getRevision.bind(postDataBucket),
            putRevision: postDataBucket.putRevision.bind(postDataBucket)
        }
    };
};
