'use strict';

const preq   = require('preq');
const assert = require('../../utils/assert.js');
const Server = require('../../utils/server.js');
const uuid = require('cassandra-uuid').TimeUuid;
const P = require('bluebird');
const parallel = require('mocha.parallel');

describe('Key value buckets', () => {

    function randomString(length) {
        let result = '';
        for (let i = 0; i < length / 10; i++) {
            result += Math.random().toString(36).slice(2);
        }
        return result;
    }

    function runTests(bucketName) {
        const server = new Server();
        let bucketBaseURI;
        before(() => server.start()
        .then(() => {
            bucketBaseURI =
                `${server.config.baseURL()}/buckets/${bucketName}/${bucketName}TestingBucket`;
            return preq.put({ uri: bucketBaseURI} );
        }));
        after(() => server.stop());

        it('stores a content in a bucket and gets it back', () => {
            const testData = randomString(60000);
            return preq.put({
                uri: `${bucketBaseURI}/Test1`,
                body: new Buffer(testData)
            })
            .then((res) => {
                assert.deepEqual(res.status, 201);
                return preq.get({
                    uri: `${bucketBaseURI}/Test1`
                });
            })
            .then((res) => {
                assert.deepEqual(res.status, 200);
                assert.deepEqual(res.body, new Buffer(testData));
            });
        });

        it('assigns etag to a value', () => {
            const testData = randomString(100);
            return preq.put({
                uri: `${bucketBaseURI}/Test3`,
                body: new Buffer(testData)
            })
            .then((res) => {
                assert.deepEqual(res.status, 201);
                return preq.get({
                    uri: `${bucketBaseURI}/Test3`
                });
            })
            .then((res) => {
                assert.deepEqual(res.status, 200);
                assert.ok(res.headers.etag);
                assert.ok(new RegExp('^"0\/').test(res.headers.etag), true);
            });
        });

        it('throws 404 error if key not found', () => {
            return preq.get({
                uri: `${bucketBaseURI}/some_not_existing_key`
            })
            .then(() => {
                throw new Error('Error should be thrown');
            }, (e) => {
                assert.deepEqual(e.status, 404);
            });
        });

        it('key_value should not overwrite same content with ignore_duplicates', () => {
            const testData = randomString(100);
            const tids = [ uuid.now().toString(),
                uuid.now().toString(),
                uuid.now().toString() ];
            return P.each(tids, (tid) => {
                return preq.put({
                    uri: `${bucketBaseURI}/List_Test_1`,
                    body: new Buffer(testData),
                    headers: {
                        'if-none-hash-match': '*'
                    }
                })
                .catch(() => {});
            })
            .then(() => {
                return preq.get({
                    uri: `${bucketBaseURI}/List_Test_1/`,
                    query: {
                        limit: 10
                    }
                });
            })
            .then((res) => {
                assert.deepEqual(res.status, 200);
                assert.deepEqual(res.body.items.length, 1);
            });
        });
    }

    parallel('key_value', () => { runTests('key_value'); });
});
