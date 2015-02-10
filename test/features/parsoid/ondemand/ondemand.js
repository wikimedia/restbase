'use strict';

// mocha defines to avoid JSHint breakage
/* global describe, it, before, beforeEach, after, afterEach */

// These tests are derived from https://phabricator.wikimedia.org/T75955,
// section 'On-demand generation of HTML and data-parsoid'

var assert = require('../../../utils/assert.js');
var server = require('../../../utils/server.js');
var preq   = require('preq');
var fs     = require('fs');

function exists(xs, f) {
    for (var i = 0; i < xs.length; i++) {
        if (f(xs[i])) {
            return true;
        }
    }
    return false;
}

// assert whether content type was as expected
function assertContentType(res, expected) {
    var actual = res.headers['content-type'];
    assert.deepEqual(actual, expected,
        'Expected content-type to be ' + expected + ', but was ' + actual);
}

// assert whether all requests in this slice went to
// /v1/en.wikipedia.test.local/***
function assertLocalRequestsOnly(slice, expected) {
    assert.deepEqual(
        !exists(slice.get(), function(line) {
            var entry = JSON.parse(line);
            return !/^\/en\.wikipedia\.test\.local\//.test(entry.req.uri);
        }),
        expected,
        expected ?
          'Should not have made remote request' :
          'Should have made a remote request'
    );
}

// assert whether some requests in this slice went to
// http://parsoid-lb.eqiad.wikimedia.org/v2/**
function assertWentToParsoid(slice, expected) {
    assert.deepEqual(
        exists(slice.get(), function(line) {
            var entry = JSON.parse(line);
            return /^http:\/\/parsoid-lb\.eqiad\.wikimedia\.org\/v2\//.test(entry.req.uri);
        }),
        expected,
        expected ?
          'Should have made a remote request to Parsoid' :
          'Should not have made a remote request to Parsoid'
    );
}

var revA = '45451075';
var revB = '623616192';
var contentUrl = server.config.bucketURL + '/LCX';

describe('on-demand generation of html and data-parsoid', function() {
    this.timeout(20000);

    before(function () { return server.start(); });

    it('should transparently create revision A via Parsoid', function () {
        var slice = server.config.logStream.slice();
        return preq.get({
            uri: contentUrl + '/data-parsoid/' + revA,
        })
        .then(function (res) {
            slice.halt();
            assertContentType(res,
              'application/json;profile=mediawiki.org/specs/data-parsoid/0.0.1');
            assert.deepEqual(typeof res.body, 'object');
            assertLocalRequestsOnly(slice, false);
            assertWentToParsoid(slice, true);
        });
    });

    it('should transparently create revision B via Parsoid', function () {
        var slice = server.config.logStream.slice();
        return preq.get({
            uri: contentUrl + '/html/' + revB,
        })
        .then(function (res) {
            slice.halt();
            assertContentType(res,
              'text/html;profile=mediawiki.org/specs/html/1.0.0');
            assert.deepEqual(typeof res.body, 'string');
            assertLocalRequestsOnly(slice, false);
            assertWentToParsoid(slice, true);
        });
    });

    it('should retrieve html revision B from storage', function () {
        var slice = server.config.logStream.slice();
        return preq.get({
            uri: contentUrl + '/html/' + revB,
        })
        .then(function (res) {
            slice.halt();
            assertContentType(res,
              'text/html;profile=mediawiki.org/specs/html/1.0.0');
            assert.deepEqual(typeof res.body, 'string');
            assertLocalRequestsOnly(slice, true);
            assertWentToParsoid(slice, false);
        });
    });

    it('should retrieve data-parsoid revision B from storage', function () {
        var slice = server.config.logStream.slice();
        return preq.get({
            uri: contentUrl + '/data-parsoid/' + revB,
        })
        .then(function (res) {
            slice.halt();
            assertContentType(res,
              'application/json;profile=mediawiki.org/specs/data-parsoid/0.0.1');
            assert.deepEqual(typeof res.body, 'object');
            assertLocalRequestsOnly(slice, true);
            assertWentToParsoid(slice, false);
        });
    });

    it('should pass (stored) html revision B to Parsoid for cache-control:no-cache',
    function () {
        // Start watching for new log entries
        var slice = server.config.logStream.slice();
        return preq.get({
            uri: contentUrl + '/html/' + revB,
            headers: {
                'cache-control': 'no-cache'
            },
        })
        .then(function (res) {
            // Stop watching for new log entries
            slice.halt();
            assertContentType(res,
              'text/html;profile=mediawiki.org/specs/html/1.0.0');
            assert.deepEqual(typeof res.body, 'string');
            assertLocalRequestsOnly(slice, false);
            assertWentToParsoid(slice, true);
        });
    });

    it('should pass (stored) data-parsoid revision B to Parsoid for cache-control:no-cache',
    function () {
        // Start watching for new log entries
        var slice = server.config.logStream.slice();
        return preq.get({
            uri: contentUrl + '/data-parsoid/' + revB,
            headers: {
                'cache-control': 'no-cache'
            },
        })
        .then(function (res) {
            // Stop watching for new log entries
            slice.halt();
            assertContentType(res,
              'application/json;profile=mediawiki.org/specs/data-parsoid/0.0.1');
            assert.deepEqual(typeof res.body, 'object');
            assertLocalRequestsOnly(slice, false);
            assertWentToParsoid(slice, true);
        });
    });

});
