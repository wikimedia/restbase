"use strict";

var P = require('bluebird');
var uuid = require('cassandra-uuid').TimeUuid;
var preq = require('preq');

var HyperSwitch = require('hyperswitch');
var HTTPError = HyperSwitch.HTTPError;
var URI = HyperSwitch.URI;

var mwUtil = require('../lib/mwUtil');

var spec = HyperSwitch.utils.loadSpec(__dirname + '/key_rev_value.yaml');

function ArchivalBucket(options) {
}

ArchivalBucket.prototype._latestName = function(bucket) {
    return bucket + '.latest';
};

ArchivalBucket.prototype._archiveName = function(bucket) {
    return bucket;
};

ArchivalBucket.prototype.createBucket = function(hyper, req) {
    var self = this;
    var rp = req.params;
    return P.join(
        hyper.put({
            uri: new URI([rp.domain, 'sys', 'key_value', self._latestName(rp.bucket)]),
            headers: req.headers,
            body: req.body
        }),
        hyper.put({
            uri: new URI([rp.domain, 'sys', 'key_rev_value', self._archiveName(rp.bucket)]),
            headers: req.headers,
            body: req.body
        })
    )
    .then(function() {
        return { status: 201 }; });
};

ArchivalBucket.prototype.getRevision = function(hyper, req) {
    var self = this;
    var rp = req.params;
    var latestRequestPath = [rp.domain, 'sys', 'key_value', self._latestName(rp.bucket), rp.key];
    if (rp.tid) {
        latestRequestPath.push(rp.tid);
    }
    return hyper.get({
        uri: new URI(latestRequestPath),
        headers: req.headers
    })
    .then(function(res) {
        if (rp.revision) {
            var etagInfo = mwUtil.parseETag(res.headers.etag);
            if (parseInt(etagInfo.rev) !== parseInt(rp.revision)
                || (rp.tid && rp.tid !== etagInfo.tid)) {
                throw new HTTPError({ status: 404 });
            }
        }
        return res;
    })
    .catch({ status: 404 }, function() {
        var olderRequestPath = [rp.domain, 'sys', 'key_rev_value',
                self._archiveName(rp.bucket), rp.key];
        if (rp.revision) {
            olderRequestPath.push('' + rp.revision);
            if (rp.tid) {
                olderRequestPath.push(rp.tid);
            }
        }
        return hyper.get({
            uri: new URI(olderRequestPath),
            headers: req.headers
        });
    });
};

ArchivalBucket.prototype.listRevisions = function(hyper, req) {
    var self = this;
    var rp = req.params;
    return hyper.get({
        uri: new URI([rp.domain, 'sys', 'key_rev_value', self._archiveName(rp.bucket), rp.key, '']),
        query: req.query
    });
};

ArchivalBucket.prototype._updateNewerRev = function(hyper, req, rev, tid) {
    var self = this;
    var rp = req.params;
    var headers = req.headers || {};
    headers.etag = headers.etag || mwUtil.makeETag(rev, tid);

    return hyper.get({
        uri: new URI([rp.domain, 'sys', 'key_value', self._latestName(rp.bucket), rp.key])
    })
    .catch({ status: 404 }, function() { /* Ignore */ })
    .then(function(res) {
        if (res) {
            var etagInfo = mwUtil.parseETag(res.headers.etag);
            if (parseInt(etagInfo.rev) > parseInt(rp.revision)) {
                return P.resolve({ status: 200 });
            }
        }
        hyper.put({
            uri: new URI([rp.domain, 'sys', 'key_value', self._latestName(rp.bucket), rp.key]),
            headers: headers,
            body: req.body
        });
    });
};

ArchivalBucket.prototype.putRevision = function(hyper, req) {
    var self = this;
    var rp = req.params;

    var rev = mwUtil.parseRevision(rp.revision, 'key_rev_large_value');
    var tid = rp.tid && mwUtil.coerceTid(rp.tid, 'key_rev_large_value') || uuid.now().toString();

    var headers = req.headers || {};
    headers.etag = headers.etag || mwUtil.makeETag(rev, tid);
    return P.join(
        hyper.put({
            uri: new URI([rp.domain, 'sys', 'key_rev_value',
                self._archiveName(rp.bucket), rp.key, '' + rev, tid]),
            headers: headers,
            body: req.body
        }),
        self._updateNewerRev(hyper, req, rev, tid)
    )
    .spread(function(res1) { return res1; });
};

module.exports = function(options) {
    var archivalBucket = new ArchivalBucket(options);

    return {
        spec: spec, // Re-export from spec module
        operations: {
            createBucket: archivalBucket.createBucket.bind(archivalBucket),
            listRevisions: archivalBucket.listRevisions.bind(archivalBucket),
            getRevision: archivalBucket.getRevision.bind(archivalBucket),
            putRevision: archivalBucket.putRevision.bind(archivalBucket)
        }
    };
};
