'use strict';

// mocha defines to avoid JSHint breakage
/* global describe, it, before, beforeEach, after, afterEach */

// These tests are derived from https://phabricator.wikimedia.org/T75955,
// section 'On-demand generation of HTML and data-parsoid'

var assert = require('../../utils/assert.js');
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

module.exports = function (config) {

    var contentUrl = config.bucketURL + '/Main_Page';
    var revA = '139992';
    var revB = '139993';

    describe('on-demand generation of html and data-parsoid', function() {

        it('should transparently create revision A via Parsoid', function () {
            var slice = config.logStream.slice();
            return preq.get({
                uri: contentUrl + '/html/' + revA,
            })
            .then(function (res) {
                slice.halt();
                assert.deepEqual(res.status, 200);
                assert.deepEqual(localRequestsOnly(slice), false);
                assert.deepEqual(wentToParsoid(slice), true);
            });
        });

        it('should transparently create revision B via Parsoid', function () {
            var slice = config.logStream.slice();
            return preq.get({
                uri: contentUrl + '/html/' + revB,
            })
            .then(function (res) {
                slice.halt();
                assert.deepEqual(res.status, 200);
                assert.deepEqual(localRequestsOnly(slice), false);
                assert.deepEqual(wentToParsoid(slice), true);
            });
        });

        it('should retrieve revision B from storage', function () {
            var slice = config.logStream.slice();
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
            var slice = config.logStream.slice();
            return preq.get({
                uri: contentUrl + '/html/' + revB,
                headers: {
                    'cache-control': 'no-cache'
                },
            })
            .then(function (res) {
                slice.halt();
                assert.deepEqual(res.status, 200);
                assert.deepEqual(localRequestsOnly(slice), false);
                assert.deepEqual(wentToParsoid(slice), true);
                var resBody = JSON.parse(res.body);
                assert.deepEqual(resBody.headers, {
                    "content-type": "text/html;profile=mediawiki.org/specs/html/1.0.0"
                });
                assert.deepEqual(/^<!DOCTYPE html>/.test(resBody.body), true);
                assert.deepEqual(/<\/html>$/.test(resBody.body), true);
            });
        });

    });

};
