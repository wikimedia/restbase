'use strict';

const preq   = require('preq');
const assert = require('../../utils/assert.js');
const server = require('../../utils/server.js');
const uuid = require('cassandra-uuid').TimeUuid;
const P = require('bluebird');

const mwUtils = require('../../../lib/mwUtil');
const parallel = require('mocha.parallel');

describe('Revisioned buckets', () => {

    before(() => {
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
        const bucketBaseURI = `${server.config.baseURL}/buckets/${bucketName
        }/${bucketName}TestingBucket`;

        before(() => {
            return preq.put({ uri: bucketBaseURI });
        });

        parallel('Newer revisions', () => {
            it('stores a content in a bucket and gets it back', () => {
                const testData = randomString(60000);
                return preq.put({
                    uri: `${bucketBaseURI}/Test1/10000`,
                    body: new Buffer(testData)
                })
                .then((res) => {
                    assert.deepEqual(res.status, 201);
                    return preq.get({
                        uri: `${bucketBaseURI}/Test1/10000`
                    });
                })
                .then((res) => {
                    assert.deepEqual(res.status, 200);
                    assert.deepEqual(res.body, new Buffer(testData));
                });
            });

            it('stores a content in a bucket and gets it back with small content', () => {
                const testData = randomString(10);
                return preq.put({
                    uri: `${bucketBaseURI}/Test2/10000`,
                    body: new Buffer(testData)
                })
                .then((res) => {
                    assert.deepEqual(res.status, 201);
                    return preq.get({
                        uri: `${bucketBaseURI}/Test2/10000`
                    });
                })
                .then((res) => {
                    assert.deepEqual(res.status, 200);
                    assert.deepEqual(res.body, new Buffer(testData));
                });
            });

            it('stores the content and its headers in a bucket and gets it back', () => {
                const testData = randomString(100);
                return preq.put({
                    uri: `${bucketBaseURI}/Test3/10000`,
                    headers: {a: 'a', b: 'b'},
                    body: new Buffer(testData)
                })
                .then((res) => {
                    assert.deepEqual(res.status, 201);
                    return preq.get({
                        uri: `${bucketBaseURI}/Test3/10000`
                    });
                })
                .then((res) => {
                    assert.deepEqual(res.status, 200);
                    assert.deepEqual(res.body, new Buffer(testData));
                    assert.deepEqual(!!res.headers, true);
                    assert.deepEqual(res.headers.a, 'a');
                    assert.deepEqual(res.headers.b, 'b');
                });
            });

            it('assigns etag to a revision', () => {
                const testData = randomString(100);
                return preq.put({
                    uri: `${bucketBaseURI}/Test4/10000`,
                    body: new Buffer(testData)
                })
                .then((res) => {
                    assert.deepEqual(res.status, 201);
                    return preq.get({
                        uri: `${bucketBaseURI}/Test4/10000`
                    });
                })
                .then((res) => {
                    assert.deepEqual(res.status, 200);
                    assert.ok(res.headers.etag);
                    assert.ok(new RegExp('^"10000\/').test(res.headers.etag), true);
                });
            });

            it('preserves the tid on write and in etag', () => {
                const tid = uuid.now().toString();
                const testData = randomString(100);
                return preq.put({
                    uri: `${bucketBaseURI}/Test4/10000/${tid}`,
                    body: new Buffer(testData)
                })
                .then((res) => {
                    assert.deepEqual(res.status, 201);
                    return preq.get({
                        uri: `${bucketBaseURI}/Test4/10000/${tid}`
                    });
                })
                .then((res) => {
                    assert.deepEqual(res.status, 200);
                    assert.ok(res.headers.etag);
                    assert.ok(new RegExp(`^"10000\/${tid}`).test(res.headers.etag), true);
                });
            });

            it('lists revisions', () => {
                const testData = randomString(100);
                return P.each([1, 2, 3], (revNumber) => {
                    return preq.put({
                        uri: `${bucketBaseURI}/Test5/${revNumber}`,
                        body: new Buffer(testData)
                    });
                })
                .then(() => {
                    return preq.get({
                        uri: `${bucketBaseURI}/Test5/`,
                        query: {
                            limit: 10
                        }
                    });
                })
                .then((res) => {
                    assert.deepEqual(res.status, 200);
                    assert.deepEqual(res.body.items.length, 3);
                    assert.deepEqual(res.body.items.map((r) => { return r.revision; }), [3, 2, 1]);
                });
            });

            it('throws error on invalid revision', () => {
                const testData = randomString(100);
                return preq.put({
                    uri: `${bucketBaseURI}/Test5/asdf`,
                    body: new Buffer(testData)
                })
                .then(() => {
                    throw new Error('Error should be thrown');
                }, (e) => {
                    assert.deepEqual(e.status, 400);
                });
            });

            it('throws error on invalid tid parameter', () => {
                const testData = randomString(100);
                return preq.put({
                    uri: `${bucketBaseURI}/Test5/1000/some_invalid_tid`,
                    body: new Buffer(testData)
                })
                .then(() => {
                    throw new Error('Error should be thrown');
                }, (e) => {
                    assert.deepEqual(e.status, 400);
                });
            });

            it('throws 404 error if revision not found', () => {
                return preq.get({
                    uri: `${bucketBaseURI}/Test5/123456789`
                })
                .then(() => {
                    throw new Error('Error should be thrown');
                }, (e) => {
                    assert.deepEqual(e.status, 404);
                });
            });
        });

        describe('Older revisions', () => {
            it('gets older revision', () => {
                const olderUUID = uuid.now().toString();
                const newerUUID = uuid.now().toString();
                return preq.put({
                    uri: `${bucketBaseURI}/Older_Test/1000/${olderUUID}`,
                    body: new Buffer('Older_Revision')
                })
                .then((res) => {
                    assert.deepEqual(res.status, 201);
                    return preq.put({
                        uri: `${bucketBaseURI}/Older_Test/1001/${newerUUID}`,
                        body: new Buffer('Newer_Revision')
                    });
                })
                .then((res) => {
                    assert.deepEqual(res.status, 201);
                    return preq.get({
                        uri: `${bucketBaseURI}/Older_Test/1000`
                    });
                })
                .then((res) => {
                    assert.deepEqual(res.body.toString(), 'Older_Revision');
                    assert.deepEqual(res.headers.etag, mwUtils.makeETag(1000, olderUUID));
                    return preq.get({
                        uri: `${bucketBaseURI}/Older_Test/1001`
                    });
                })
                .then((res) => {
                    assert.deepEqual(res.body.toString(), 'Newer_Revision');
                    assert.deepEqual(res.headers.etag, mwUtils.makeETag(1001, newerUUID));
                });
            });

            it('gets older revision - out of order write', () => {
                const olderUUID = uuid.now().toString();
                const newerUUID = uuid.now().toString();
                return preq.put({
                    uri: `${bucketBaseURI}/Older_Test/1001/${newerUUID}`,
                    body: new Buffer('Newer_Revision')
                })
                .then((res) => {
                    assert.deepEqual(res.status, 201);
                    return preq.put({
                        uri: `${bucketBaseURI}/Older_Test/1000/${olderUUID}`,
                        body: new Buffer('Older_Revision')
                    });
                })
                .then((res) => {
                    assert.deepEqual(res.status, 201);
                    return preq.get({
                        uri: `${bucketBaseURI}/Older_Test/1000`
                    });
                })
                .then((res) => {
                    assert.deepEqual(res.body.toString(), 'Older_Revision');
                    assert.deepEqual(res.headers.etag, mwUtils.makeETag(1000, olderUUID));
                    return preq.get({
                        uri: `${bucketBaseURI}/Older_Test/1001`
                    });
                })
                .then((res) => {
                    assert.deepEqual(res.body.toString(), 'Newer_Revision');
                    assert.deepEqual(res.headers.etag, mwUtils.makeETag(1001, newerUUID));
                });
            });
        });
    }

    describe('key_rev_value', () => runTests('key_rev_value'));
});
