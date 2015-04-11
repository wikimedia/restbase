'use strict';

// mocha defines to avoid JSHint breakage
/* global describe, it, before, beforeEach, after, afterEach */

var assert = require('../utils/assert.js');
var server = require('../utils/server.js');
var preq   = require('preq');
var P = require('bluebird');

describe('simple_service', function () {
    this.timeout(20000);

    before(function () { return server.start(); });

    // A test page that includes the current date, so that it changes if
    // re-rendered more than a second apart.
    var testPage = server.config.baseURL + '/service/test/User:GWicke%2fDate';

    function hasTextContentType(res) {
        assert.contentType(res, 'text/html');
    }

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

            // delay for 1s to make sure that the timestamp differs on re-render
            return P.delay(1100)
            .then(function() {
                return preq.get({
                    uri: testPage,
                    headers: { 'cache-control': 'no-cache' }
                });
            });
        })
        .then(function (res) {
            // Since this is a dynamic page which should render the same each
            // time, the tid should not change.
            tid2 = res.headers.etag;
            assert.notDeepEqual(tid2, tid1);
            assert.notDeepEqual(tid2, undefined);
            hasTextContentType(res);
        });
    });

});
