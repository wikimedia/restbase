'use strict';

const preq   = require('preq');
const assert = require('../../utils/assert.js');
const Server = require('../../utils/server.js');
const uuidv1 = require('uuid');
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
        const server = new Server(`${__dirname}/../../../config.example.storage.wikimedia.yaml`, true);
        let bucketBaseURI;
        let stringBaseURI;
        before(() => server.start()
        .then(() => {
            bucketBaseURI = `${server.config.baseURL()}/${bucketName}/${bucketName}TestingBucket`;
            return preq.put({uri: bucketBaseURI});
        })
        .then(() => {
            stringBaseURI = `${server.config.baseURL()}/${bucketName}/${bucketName}StringBucket`;
            return preq.put({
                uri: stringBaseURI,
                headers: {
                    'content-type': 'application/json'
                },
                body: {
                    valueType: 'string'
                }
            });
        }));
        after(() => server.stop());

        it('stores a content in a bucket and gets it back', () => {
            console.log(bucketBaseURI);
            const testData = randomString(100);
            return preq.put({
                uri: `${bucketBaseURI}/${testData}`,
                body: new Buffer(testData)
            })
            .then((res) => {
                assert.deepEqual(res.status, 201);
                return preq.get({
                    uri: `${bucketBaseURI}/${testData}`
                });
            })
            .then((res) => {
                assert.deepEqual(res.status, 200);
                assert.deepEqual(res.body, new Buffer(testData));
            });
        });
        it('Supports text/plain', () => {
            const testData = randomString(100);
            return preq.put({
                uri: `${stringBaseURI}/${testData}`,
                headers: {
                    'content-type': 'text/plain',
                    'x-store-content-type': 'text/plain'
                },
                body: testData
            })
            .then((res) => {
                assert.deepEqual(res.status, 201);
                return preq.get({
                    uri: `${stringBaseURI}/${testData}`
                });
            })
            .then((res) => {
                assert.deepEqual(res.status, 200);
                assert.deepEqual(res.body, testData);
                assert.deepEqual(res.headers['content-type'], 'text/plain');
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

        it('Preserves x-store headers and removes others', () => {
            const testData = randomString(100);
            return preq.put({
                uri: `${bucketBaseURI}/${testData}`,
                headers: {
                    'x-store-preserved': 'this_will_be_stored',
                    'non-preserved': 'this_will_not_be_stored'
                },
                body: new Buffer(testData)
            })
            .then((res) => {
                assert.deepEqual(res.status, 201);
                return preq.get({
                    uri: `${bucketBaseURI}/${testData}`
                });
            })
            .then((res) => {
                assert.deepEqual(res.status, 200);
                assert.deepEqual(res.headers['preserved'], 'this_will_be_stored');
                assert.deepEqual(res.headers['non-preserved'], undefined);
            });
        });

        it('key_value should not overwrite same content with ignore_duplicates', () => {
            const testData = randomString(100);
            const originalEtag = uuidv1();
            const etags = [ originalEtag,
                uuidv1(),
                uuidv1() ];
            return P.each(etags, (etag) => preq.put({
                    uri: `${bucketBaseURI}/List_Test_1`,
                    body: new Buffer(testData),
                    headers: {
                        'if-none-hash-match': '*',
                        'x-store-etag': etag
                    }
                })
                .catch(() => {
                })
            )
            .then(() => {
                return preq.get({
                    uri: `${bucketBaseURI}/List_Test_1`
                });
            })
            .then((res) => {
                assert.deepEqual(res.status, 200);
                assert.deepEqual(res.headers.etag, originalEtag);
            });
        });
    }

    parallel('key_value', () => { runTests('key_value'); });
});
