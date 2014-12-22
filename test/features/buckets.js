'use strict';

// mocha defines to avoid JSHint breakage
/* global describe, it, before, beforeEach, after, afterEach */

var assert = require('../utils/assert.js');
var preq = require('preq');

module.exports = function (config) {

    describe('Domain & bucket creation', function() {
        it('should create a domain', function() {
            return preq.put({
                uri: config.hostPort + '/v1/en.wikipedia.test.local',
                headers: { 'content-type': 'application/json' },
                body: {}
            })
            .then(function(res) {
                assert.deepEqual(res.status, 201);
            });
        });
    });
    describe('Bucket creation', function() {
        it('should require a bucket type', function() {
            this.timeout(20000);
            return assert.fails(
                preq.put({
                    uri: config.bucketURL,
                    headers: { 'content-type': 'application/json' },
                    body: {}
                }),
                function (e) {
                    assert.deepEqual(e.status, 400);
                    assert.deepEqual(e.body.title, 'Invalid bucket spec.');
                }
            );
        });
        it('should require a valid bucket type', function() {
            this.timeout(20000);
            return assert.fails(
                preq.put({
                    uri: config.bucketURL,
                    headers: { 'content-type': 'application/json' },
                    body: { type: 'wazzle' }
                }),
                function (e) {
                    assert.deepEqual(e.status, 400);
                    assert.deepEqual(e.body.title, 'Invalid bucket spec.');
                }
            );
        });
        it('should create a page bucket', function() {
            this.timeout(20000);
            return preq.put({
                uri: config.bucketURL,
                headers: { 'content-type': 'application/json' },
                body: { type: 'pagecontent' }
            })
            .then(function(res) {
                assert.deepEqual(res.status, 201);
            });
        });
    });

};
