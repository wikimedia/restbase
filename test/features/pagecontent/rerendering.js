'use strict';

// mocha defines to avoid JSHint breakage
/* global describe, it, before, beforeEach, after, afterEach */

var assert = require('../../utils/assert.js');
var preq = require('preq');


module.exports = function (config) {

    describe('page re-rendering', function () {
        this.timeout(20000);

        var r1 = '615503804';
        var r2 = '615503846';


        function hasTextContentType(res) {
            var ctype = res.headers['content-type'];
            if (!/text\/html/.test(ctype)) {
                throw new Error('Content-type does not match text/html: ' + ctype);
            }
        }


        it('should render & re-render independent revisions', function () {
            var r1tid1;
            var r1tid2;
            var r2tid1;
            return preq.get({
                uri: config.bucketURL + '/Main_Page/html/' + r1
            })
            .then(function (res) {
                assert.deepEqual(res.status, 200);
                r1tid1 = res.headers.etag;
                hasTextContentType(res);

                return preq.get({
                    uri: config.bucketURL + '/Main_Page/html/' + r1,
                    headers: { 'cache-control': 'no-cache' }
                }).delay(500);
            })
            .then(function (res) {
                r1tid2 = res.headers.etag;
                assert.notDeepEqual(r1tid2, r1tid1);
                assert.notDeepEqual(r1tid2, undefined);
                hasTextContentType(res);

                return preq.get({
                    uri: config.bucketURL + '/Main_Page/html/' + r1 + '/' + r1tid1
                });
            })
            .then(function (res) {
                assert.deepEqual(res.headers.etag, r1tid1);
                hasTextContentType(res);

                return preq.get({
                    uri: config.bucketURL + '/Main_Page/html/' + r1
                });
            })
            .then(function (res) {
                assert.deepEqual(res.headers.etag, r1tid2);
                hasTextContentType(res);

                return preq.get({
                    uri: config.bucketURL + '/Main_Page/html/' + r1 + '/' + r1tid2
                });
            })
            .then(function (res) {
                assert.deepEqual(res.headers.etag, r1tid2);
                hasTextContentType(res);

                return preq.get({
                    uri: config.bucketURL + '/Main_Page/html/' + r2
                }).delay(500);
            })
            .then(function (res) {
                r2tid1 = res.headers.etag;
                assert.deepEqual(res.status, 200);
                hasTextContentType(res);

                // Delay a bit to give the async save time to complete
                return preq.get({
                    uri: config.bucketURL + '/Main_Page/html/' + r2 + '/' + r2tid1
                });
            })
            .then(function (res) {
                assert.deepEqual(res.headers.etag, r2tid1);
                hasTextContentType(res);

                return preq.get({
                    uri: config.bucketURL + '/Main_Page/html/' + r1
                });
            })
            .then(function (res) {
                assert.deepEqual(res.headers.etag, r1tid2);
                hasTextContentType(res);
            });
        });

    });
};
