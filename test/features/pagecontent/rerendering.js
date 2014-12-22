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

        var r1tid1 = '8b0a6880-0311-11e4-9234-0123456789ab';
        var r1tid2 = r1tid1;
        var r2tid1 = '9b224800-0311-11e4-9234-0123456789ab';

        it('should retrieve Main_Page revision r1 - ' + r1, function () {
            return preq.get({
                uri: config.bucketURL + '/Main_Page/html/' + r1
            })
            .then(function (res) {
                assert.deepEqual(res.headers.etag, r1tid1);
            });
        });

        it('should re-render and retrieve Main_Page revision r1 - ' + r1, function () {
            return preq.get({
                uri: config.bucketURL + '/Main_Page/html/' + r1,
                headers: { 'cache-control': 'no-cache' }
            })
            .then(function (res) {
                r1tid2 = res.headers.etag;
                assert.notDeepEqual(r1tid2, r1tid1);
                assert.notDeepEqual(r1tid2, r2tid1);
            });
        });

        it('should retrieve Main_Page revision r1tid1 - ' + r1tid1, function () {
            return preq.get({
                uri: config.bucketURL + '/Main_Page/html/' + r1tid1
            })
            .then(function (res) {
                assert.deepEqual(res.headers.etag, r1tid1);
            });
        });

        it('should retrieve re-rendered Main_Page revision r1 - ' + r1, function () {
            return preq.get({
                uri: config.bucketURL + '/Main_Page/html/' + r1
            })
            .then(function (res) {
                assert.deepEqual(res.headers.etag, r1tid2);
            });
        });

        it('should retrieve re-rendered Main_Page revision r1tid2 - ' + r1tid2, function () {
            return preq.get({
                uri: config.bucketURL + '/Main_Page/html/' + r1tid2
            })
            .then(function (res) {
                assert.deepEqual(res.headers.etag, r1tid2);
            });
        });

        it('should retrieve Main_Page revision r2 - ' + r2, function () {
            return preq.get({
                uri: config.bucketURL + '/Main_Page/html/' + r2
            })
            .then(function (res) {
                assert.deepEqual(res.headers.etag, r2tid1);
            });
        });

        it('should retrieve Main_Page revision r2tid1 - ' + r2tid1, function () {
            return preq.get({
                uri: config.bucketURL + '/Main_Page/html/' + r2tid1
            })
            .then(function (res) {
                assert.deepEqual(res.headers.etag, r2tid1);
            });
        });

        it('should retrieve re-rendered Main_Page revision r1 - ' + r1, function () {
            return preq.get({
                uri: config.bucketURL + '/Main_Page/html/' + r1
            })
            .then(function (res) {
                assert.deepEqual(res.headers.etag, r1tid2);
            });
        });

    });
};
