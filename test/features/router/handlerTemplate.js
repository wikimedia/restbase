'use strict';

// mocha defines to avoid JSHint breakage
/* global describe, it, before, beforeEach, after, afterEach */

var assert = require('../../utils/assert.js');
var server = require('../../utils/server.js');
var preq   = require('preq');
var P = require('bluebird');

describe('handler template', function () {
    this.timeout(20000);

    before(function () { return server.start(); });

    // A test page that includes the current date, so that it changes if
    // re-rendered more than a second apart.
    var testPage = server.config.baseURL + '/service/test/User:GWicke%2fDate';

    function hasTextContentType(res) {
        assert.contentType(res, 'text/html');
    }

    var slice;

    it('retrieve content from backend service', function () {
        var tid1;
        var tid2;
        return preq.get({
            uri: testPage
        })
        .then(function (res) {
            assert.deepEqual(res.status, 200);
            tid1 = res.headers.etag;
            hasTextContentType(res);

            // Delay for 1s to make sure that the content differs on
            // re-render, then force a re-render and check that it happened.
            slice = server.config.logStream.slice();
            return P.delay(1100)
            .then(function() {
                return preq.get({
                    uri: testPage,
                    headers: { 'cache-control': 'no-cache' }
                });
            });
        })
        .then(function (res) {
            tid2 = res.headers.etag;
            assert.notDeepEqual(tid2, tid1);
            assert.notDeepEqual(tid2, undefined);
            hasTextContentType(res);
            slice.halt();
            assert.remoteRequests(slice, true);
            // delay for 1s to let the content change on re-render
            slice = server.config.logStream.slice();

            // Check retrieval of a stored render
            return P.delay(1100)
            .then(function() {
                return preq.get({
                    uri: testPage,
                });
            });
        })
        .then(function (res) {
            var tid3 = res.headers.etag;
            assert.deepEqual(tid3, tid2);
            assert.notDeepEqual(tid3, undefined);
            // Check that there were no remote requests
            slice.halt();
            assert.remoteRequests(slice, false);
            hasTextContentType(res);
        });
    });
});
