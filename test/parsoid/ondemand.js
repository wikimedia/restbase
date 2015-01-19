'use strict';

// mocha defines to avoid JSHint breakage
/* global describe, it, before, beforeEach, after, afterEach */

// These tests are derived from https://phabricator.wikimedia.org/T75955,
// section 'On-demand generation of HTML and data-parsoid'

var server = require('../utils/server.js');
var assert = require('../utils/assert.js');
var preq = require('preq');
var fs = require('fs');

function exists(xs, f) {
    for (var i = 0; i < xs.length; i++) {
        if (f(xs[i])) {
            return true;
        }
    }
    return false;
}

// returns true if all requests in this slice went to
// /v1/en.wikipedia.test.local/***
function localRequestsOnly(slice) {
    return !exists(slice.get(), function(line) {
      var entry = JSON.parse(line);
      return !/^\/v1\/en\.wikipedia\.test\.local\//.test(entry.req.uri);
    });
}

// return true if some requests in this slice went to 
// http://parsoid-lb.eqiad.wikimedia.org/v2/**
function wentToParsoid(slice) {
    return exists(slice.get(), function(line) {
      var entry = JSON.parse(line);
      return /^http:\/\/parsoid-lb\.eqiad\.wikimedia\.org\/v2\//.test(entry.req.uri);
    });
}

describe('on-demand generation of html and data-parsoid', function() {
    this.timeout(20000);

    before(function () { return server.start(); });

    var contentUrl = server.config.bucketURL + '/Main_Page';
    var revA = '139992';
    var revB = '139993';

    it('should transparently create revision A via Parsoid as needed', function () {
        var slice = server.config.logStream.slice();
        return preq.get({
            uri: contentUrl + '/html/' + revA,
        })
        .then(function (res) {
            slice.halt();
            assert.deepEqual(res.status, 200);
        });
    });

    it('should transparently create revision B via Parsoid as needed', function () {
        var slice = server.config.logStream.slice();
        return preq.get({
            uri: contentUrl + '/html/' + revB,
        })
        .then(function (res) {
            slice.halt();
            assert.deepEqual(res.status, 200);
        });
    });

    it('should retrieve revision B from storage', function () {
        var slice = server.config.logStream.slice();
        return preq.get({
            uri: contentUrl + '/html/' + revB,
        })
        .then(function (res) {
            slice.halt();
            assert.deepEqual(res.status, 200);
            assert.deepEqual(localRequestsOnly(slice), true);
            assert.deepEqual(wentToParsoid(slice), false);
        });
    });

    it('should pass (stored) revision B to Parsoid for cache-control:no-cache',
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
            assert.deepEqual(res.status, 200);
            assert.deepEqual(localRequestsOnly(slice), false);
            assert.deepEqual(wentToParsoid(slice), true);
            assert.deepEqual(res.headers['content-type'], 'text/html;profile=mediawiki.org/specs/html/1.0.0');
            assert.deepEqual(/^<!DOCTYPE html>/.test(res.body), true);
            assert.deepEqual(/<\/html>$/.test(res.body), true);
        });
    });

});
