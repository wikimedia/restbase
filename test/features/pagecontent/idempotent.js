'use strict';

// mocha defines to avoid JSHint breakage
/* global describe, it, before, beforeEach, after, afterEach */

var assert = require('../../utils/assert.js');
var preq = require('preq');

module.exports = function (config) {

    describe('idempotent item requests', function() {
        it('should accept a new html save with a revision', function() {
            return preq.put({
                uri: config.bucketURL + '/Idempotent/html/76f22880-362c-11e4-9234-0123456789ab',
                headers: { 'content-type': 'text/html; charset=UTF-8' },
                body: 'Hello there'
            })
            .then(function(res) {
                assert.deepEqual(res.status, 201);
            })
            .catch(function(e) {
                console.dir(e);
                throw e;
            });
        });
        it('should return the HTML revision just created', function() {
            return preq.get({
                uri: config.bucketURL + '/Idempotent/html/76f22880-362c-11e4-9234-0123456789ab'
            })
            .then(function(res) {
                assert.deepEqual(res.status, 200);
                assert.deepEqual(res.headers['content-type'], 'text/html; charset=UTF-8');
                assert.deepEqual(res.headers.etag, '76f22880-362c-11e4-9234-0123456789ab');
                assert.deepEqual(res.body.toString(), 'Hello there');
            });
        });

    });
};
