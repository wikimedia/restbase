'use strict';

// mocha defines to avoid JSHint breakage
/* global describe, it, before, beforeEach, after, afterEach */

var assert = require('../../utils/assert.js');
var preq   = require('preq');
var server = require('../../utils/server.js');
var P = require('bluebird');

describe('page re-rendering', function () {
    this.timeout(20000);

    before(function () { return server.start(); });

    // A test page that includes the current date, so that it changes if
    // re-rendered more than a second apart.
    var dynamic1 = '/html/User:GWicke%2fDate/653530930';
    var dynamic2 = '/html/User:GWicke%2fDate/653529842';

    function hasTextContentType(res) {
        assert.contentType(res, 'text/html');
    }

    it('should render & re-render independent revisions', function () {
        var r1tid1;
        var r1tid2;
        var r2tid1;
        return preq.get({
            uri: server.config.bucketURL + dynamic1
        })
        .then(function (res) {
            assert.deepEqual(res.status, 200);
            r1tid1 = res.headers.etag;
            hasTextContentType(res);

            // delay for 1s to make sure that the timestamp differs on re-render
            return P.delay(1500)
            .then(function() {
                return preq.get({
                    uri: server.config.bucketURL + dynamic1,
                    headers: { 'cache-control': 'no-cache' }
                });
            });
        })
        .then(function (res) {
            // Since this is a dynamic page which should render the same each
            // time, the tid should not change.
            r1tid2 = res.headers.etag;
            assert.notDeepEqual(r1tid2, r1tid1);
            assert.notDeepEqual(r1tid2, undefined);
            hasTextContentType(res);

            return preq.get({
                uri: server.config.bucketURL + dynamic1 + '/' + r1tid1
            });
        })
        .then(function (res) {
            assert.deepEqual(res.headers.etag, r1tid1);
            hasTextContentType(res);

            return preq.get({
                uri: server.config.bucketURL + dynamic1
            });
        })
        .then(function (res) {
            assert.deepEqual(res.headers.etag, r1tid2);
            hasTextContentType(res);

            return preq.get({
                uri: server.config.bucketURL + dynamic1 + '/' + r1tid2
            });
        })
        .then(function (res) {
            assert.deepEqual(res.headers.etag, r1tid2);
            hasTextContentType(res);

            return preq.get({
                uri: server.config.bucketURL + dynamic2
            });
        })
        .then(function (res) {
            r2tid1 = res.headers.etag;
            assert.deepEqual(res.status, 200);
            hasTextContentType(res);

            return preq.get({
                uri: server.config.bucketURL + dynamic2 + '/' + r2tid1
            });
        })
        .then(function (res) {
            assert.deepEqual(res.headers.etag, r2tid1);
            hasTextContentType(res);

            return preq.get({
                uri: server.config.bucketURL + dynamic1
            });
        })
        .then(function (res) {
            assert.deepEqual(res.headers.etag, r1tid2);
            hasTextContentType(res);
        });
    });

    it('should render & re-render independent revisions, if-unmodified-since support', function () {
        return preq.get({
            uri: server.config.bucketURL + dynamic1,
            headers: {
                'cache-control': 'no-cache',
                'if-unmodified-since': 'Wed Dec 11 2013 16:00:00 GMT-0800',
            }
        })
        .then(function() {
            throw new Error('Expected a precondition failure');
        },
        function(res) {
            assert.deepEqual(res.status, 412);
        });
    });

    // A static test page
    var static1 = '/html/User:GWicke%2fStatic/653529880';
    var static2 = '/html/User:GWicke%2fStatic/653529961';

    it('should render & re-render independent revisions, but not update unchanged content', function () {
        var r1tid1;
        var r1tid2;
        var r2tid1;
        return preq.get({
            uri: server.config.bucketURL + static1
        })
        .then(function (res) {
            assert.deepEqual(res.status, 200);
            r1tid1 = res.headers.etag;
            hasTextContentType(res);

            return preq.get({
                uri: server.config.bucketURL + static1,
                headers: { 'cache-control': 'no-cache' }
            });
        })
        .then(function (res) {
            // Since this is a static page which should render the same each
            // time, the tid should not change.
            r1tid2 = res.headers.etag;
            assert.deepEqual(r1tid2, r1tid1);
            assert.notDeepEqual(r1tid2, undefined);
            hasTextContentType(res);

            return preq.get({
                uri: server.config.bucketURL + static1 + '/' + r1tid1
            });
        })
        .then(function (res) {
            assert.deepEqual(res.headers.etag, r1tid1);
            hasTextContentType(res);

            return preq.get({
                uri: server.config.bucketURL + static1
            });
        })
        .then(function (res) {
            assert.deepEqual(res.headers.etag, r1tid2);
            hasTextContentType(res);

            return preq.get({
                uri: server.config.bucketURL + static1 + '/' + r1tid2
            });
        })
        .then(function (res) {
            assert.deepEqual(res.headers.etag, r1tid2);
            hasTextContentType(res);

            return preq.get({
                uri: server.config.bucketURL + static2
            });
        })
        .then(function (res) {
            r2tid1 = res.headers.etag;
            assert.deepEqual(res.status, 200);
            hasTextContentType(res);

            return preq.get({
                uri: server.config.bucketURL + static2 + '/' + r2tid1
            });
        })
        .then(function (res) {
            assert.deepEqual(res.headers.etag, r2tid1);
            hasTextContentType(res);

            return preq.get({
                uri: server.config.bucketURL + static1
            });
        })
        .then(function (res) {
            assert.deepEqual(res.headers.etag, r1tid2);
            hasTextContentType(res);
        });
    });

});
