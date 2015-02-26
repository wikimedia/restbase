'use strict';

// mocha defines to avoid JSHint breakage
/* global describe, it, before, beforeEach, after, afterEach */

var assert = require('../../utils/assert.js');
var preq   = require('preq');
var server = require('../../utils/server.js');

describe('page re-rendering', function () {
    this.timeout(20000);

    before(function () { return server.start(); });

    var r1 = '615503804';
    var r2 = '615503846';


    function hasTextContentType(res) {
        assert.contentType(res, 'text/html');
    }


    it('should render & re-render independent revisions', function () {
        var r1tid1;
        var r1tid2;
        var r2tid1;
        return preq.get({
            uri: server.config.bucketURL + '/html/Main_Page/' + r1
        })
        .then(function (res) {
            assert.deepEqual(res.status, 200);
            r1tid1 = res.headers.etag;
            hasTextContentType(res);

            return preq.get({
                uri: server.config.bucketURL + '/html/Main_Page/' + r1,
                headers: { 'cache-control': 'no-cache' }
            }).delay(500);
        })
        .then(function (res) {
            r1tid2 = res.headers.etag;
            assert.notDeepEqual(r1tid2, r1tid1);
            assert.notDeepEqual(r1tid2, undefined);
            hasTextContentType(res);

            return preq.get({
                uri: server.config.bucketURL + '/html/Main_Page/' + r1 + '/' + r1tid1
            });
        })
        .then(function (res) {
            assert.deepEqual(res.headers.etag, r1tid1);
            hasTextContentType(res);

            return preq.get({
                uri: server.config.bucketURL + '/html/Main_Page/' + r1
            });
        })
        .then(function (res) {
            assert.deepEqual(res.headers.etag, r1tid2);
            hasTextContentType(res);

            return preq.get({
                uri: server.config.bucketURL + '/html/Main_Page/' + r1 + '/' + r1tid2
            });
        })
        .then(function (res) {
            assert.deepEqual(res.headers.etag, r1tid2);
            hasTextContentType(res);

            return preq.get({
                uri: server.config.bucketURL + '/html/Main_Page/' + r2
            }).delay(500);
        })
        .then(function (res) {
            r2tid1 = res.headers.etag;
            assert.deepEqual(res.status, 200);
            hasTextContentType(res);

            // Delay a bit to give the async save time to complete
            return preq.get({
                uri: server.config.bucketURL + '/html/Main_Page/' + r2 + '/' + r2tid1
            });
        })
        .then(function (res) {
            assert.deepEqual(res.headers.etag, r2tid1);
            hasTextContentType(res);

            return preq.get({
                uri: server.config.bucketURL + '/html/Main_Page/' + r1
            });
        })
        .then(function (res) {
            assert.deepEqual(res.headers.etag, r1tid2);
            hasTextContentType(res);
        });
    });

});
