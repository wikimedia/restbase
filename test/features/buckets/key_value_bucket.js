"use strict";

const preq   = require('preq');
const assert = require('../../utils/assert.js');
const server = require('../../utils/server.js');
const uuid = require('cassandra-uuid').TimeUuid;
const P = require('bluebird');
const parallel = require('mocha.parallel');

describe('Key value buckets', function() {

    before(function() {
        return server.start();
    });

    function randomString(length) {
        let result = '';
        for (let i = 0; i < length / 10; i++) {
            result += Math.random().toString(36).slice(2);
        }
        return result;
    }

    function runTests(bucketName) {
        const bucketBaseURI = server.config.baseURL + '/buckets/' + bucketName
        + '/' + bucketName + 'TestingBucket';

        before(function() {
            return preq.put({ uri: bucketBaseURI });
        });

        it('stores a content in a bucket and gets it back', function() {
            const testData = randomString(60000);
            return preq.put({
                uri: bucketBaseURI + '/Test1',
                body: new Buffer(testData)
            })
            .then(function(res) {
                assert.deepEqual(res.status, 201);
                return preq.get({
                    uri: bucketBaseURI + '/Test1'
                });
            })
            .then(function(res) {
                assert.deepEqual(res.status, 200);
                assert.deepEqual(res.body, new Buffer(testData));
            });
        });

        it('assigns etag to a value', function() {
            const testData = randomString(100);
            return preq.put({
                uri: bucketBaseURI + '/Test3',
                body: new Buffer(testData)
            })
            .then(function(res) {
                assert.deepEqual(res.status, 201);
                return preq.get({
                    uri: bucketBaseURI + '/Test3'
                });
            })
            .then(function(res) {
                assert.deepEqual(res.status, 200);
                assert.ok(res.headers.etag);
                assert.ok(new RegExp('^"0\/').test(res.headers.etag), true);
            });
        });

        it('preserves the tid on write and in etag', function() {
            const tid = uuid.now().toString();
            const testData = randomString(100);
            return preq.put({
                uri: bucketBaseURI + '/Test3/' + tid,
                body: new Buffer(testData)
            })
            .then(function(res) {
                assert.deepEqual(res.status, 201);
                return preq.get({
                    uri: bucketBaseURI + '/Test3/' + tid
                });
            })
            .then(function(res) {
                assert.deepEqual(res.status, 200);
                assert.ok(res.headers.etag);
                assert.ok(new RegExp('^"0\/' + tid).test(res.headers.etag), true);
            });
        });

        it('lists value tids', function() {
            const testData = randomString(100);
            const tids = [ uuid.now().toString(),
                uuid.now().toString(),
                uuid.now().toString() ];
            let i = 0;
            return P.each(tids, function(tid) {
                return preq.put({
                    uri: bucketBaseURI + '/List_Test/' + tid,
                    body: new Buffer(testData + i++)
                })
            })
            .then(function() {
                return preq.get({
                    uri: bucketBaseURI + '/List_Test/',
                    query: {
                        limit: 10
                    }
                });
            })
            .then(function(res) {
                assert.deepEqual(res.status, 200);
                assert.deepEqual(res.body.items.length, 3);
                assert.deepEqual(res.body.items, tids.reverse());
            });
        });

        it('throws error on invalid tid parameter', function() {
            const testData = randomString(100);
            return preq.put({
                uri: bucketBaseURI + '/Test4/some_invalid_tid',
                body: new Buffer(testData)
            })
            .then(function() {
                throw new Error('Error should be thrown');
            }, function(e) {
                assert.deepEqual(e.status, 400);
            });
        });

        it('throws 404 error if key not found', function() {
            const testData = randomString(100);
            return preq.get({
                uri: bucketBaseURI + '/some_not_existing_key'
            })
            .then(function() {
                throw new Error('Error should be thrown');
            }, function(e) {
                assert.deepEqual(e.status, 404);
            });
        });

        it('key_value should not overwrite same content with ignore_duplicates', () => {
            const testData = randomString(100);
            const tids = [ uuid.now().toString(),
                uuid.now().toString(),
                uuid.now().toString() ];
            let i = 0;
            return P.each(tids, function(tid) {
                return preq.put({
                    uri: bucketBaseURI + '/List_Test_1/' + tid,
                    body: new Buffer(testData),
                    headers: {
                        'if-none-hash-match': '*'
                    }
                })
            })
            .then(function() {
                return preq.get({
                    uri: bucketBaseURI + '/List_Test_1/',
                    query: {
                        limit: 10
                    }
                });
            })
            .then(function(res) {
                assert.deepEqual(res.status, 200);
                assert.deepEqual(res.body.items.length, 1);
                assert.deepEqual(res.body.items[0], tids[0]);
            });
        });
    }

    parallel('key_value', function() { runTests('key_value') });
});