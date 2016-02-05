"use strict";

var preq   = require('preq');
var assert = require('../../utils/assert.js');
var server = require('../../utils/server.js');
var uuid = require('cassandra-uuid').TimeUuid;
var P = require('bluebird');

describe('Revisioned buckets', function() {

    before(function() {
        return server.start();
    });

    function randomString(length) {
        var result = '';
        for (var i = 0; i < length / 10; i++) {
            result += Math.random().toString(36).slice(2);
        }
        return result;
    }

    function runTests(bucketName) {
        var bucketBaseURI = server.config.baseURL + '/buckets/' + bucketName
                + '/' + bucketName + 'TestingBucket';

        before(function() {
            return preq.put({ uri: bucketBaseURI });
        });

        it('stores a content in a bucket and gets it back', function() {
            var testData = randomString(60000);
            return preq.put({
                uri: bucketBaseURI + '/Test1/10000',
                body: new Buffer(testData)
            })
            .then(function(res) {
                assert.deepEqual(res.status, 201);
                return preq.get({
                    uri: bucketBaseURI + '/Test1/10000'
                });
            })
            .then(function(res) {
                assert.deepEqual(res.status, 200);
                assert.deepEqual(res.body, new Buffer(testData));
            });
        });

        it('stores a content in a bucket and gets it back with small content', function() {
            var testData = randomString(10);
            return preq.put({
                uri: bucketBaseURI + '/Test2/10000',
                body: new Buffer(testData)
            })
            .then(function(res) {
                assert.deepEqual(res.status, 201);
                return preq.get({
                    uri: bucketBaseURI + '/Test2/10000'
                });
            })
            .then(function(res) {
                assert.deepEqual(res.status, 200);
                assert.deepEqual(res.body, new Buffer(testData));
            });
        });

        it('assigns etag to a revision', function() {
            var testData = randomString(100);
            return preq.put({
                uri: bucketBaseURI + '/Test3/10000',
                body: new Buffer(testData)
            })
            .then(function(res) {
                assert.deepEqual(res.status, 201);
                return preq.get({
                    uri: bucketBaseURI + '/Test3/10000'
                });
            })
            .then(function(res) {
                assert.deepEqual(res.status, 200);
                assert.ok(res.headers.etag);
                assert.ok(new RegExp('^"10000\/').test(res.headers.etag), true);
            });
        });

        it('preserves the tid on write and in etag', function() {
            var tid = uuid.now().toString();
            var testData = randomString(100);
            return preq.put({
                uri: bucketBaseURI + '/Test3/10000/' + tid,
                body: new Buffer(testData)
            })
            .then(function(res) {
                assert.deepEqual(res.status, 201);
                return preq.get({
                    uri: bucketBaseURI + '/Test3/10000/' + tid
                });
            })
            .then(function(res) {
                assert.deepEqual(res.status, 200);
                assert.ok(res.headers.etag);
                assert.ok(new RegExp('^"10000\/' + tid).test(res.headers.etag), true);
            });
        });

        it('lists revisions', function() {
            var testData = randomString(100);
            return P.each([1, 2, 3], function(revNumber) {
                return preq.put({
                    uri: bucketBaseURI + '/Test4/' + revNumber,
                    body: new Buffer(testData)
                })
            })
            .then(function() {
                return preq.get({
                    uri: bucketBaseURI + '/Test4/',
                    query: {
                        limit: 10
                    }
                });
            })
            .then(function(res) {
                assert.deepEqual(res.status, 200);
                assert.deepEqual(res.body.items.length, 3);
                assert.deepEqual(res.body.items.map(function(r) { return r.revision; }), [3, 2, 1]);
            });
        });

        it('throws error on invalid revision', function() {
            var testData = randomString(100);
            return preq.put({
                uri: bucketBaseURI + '/Test4/asdf',
                body: new Buffer(testData)
            })
            .then(function() {
                throw new Error('Error should be thrown');
            }, function(e) {
                assert.deepEqual(e.status, 400);
            });
        });

        it('throws error on invalid tid parameter', function() {
            var testData = randomString(100);
            return preq.put({
                uri: bucketBaseURI + '/Test4/1000/some_invalid_tid',
                body: new Buffer(testData)
            })
            .then(function() {
                throw new Error('Error should be thrown');
            }, function(e) {
                assert.deepEqual(e.status, 400);
            });
        });

        it('throws 404 error if revision not found', function() {
            return preq.get({
                uri: bucketBaseURI + '/Test4/123456789'
            })
            .then(function() {
                throw new Error('Error should be thrown');
            }, function(e) {
                assert.deepEqual(e.status, 404);
            });
        });
    }

    describe('key_rev_value', function() { runTests('key_rev_value') });
    describe('key_rev_large_value', function() { runTests('key_rev_large_value'); });
});