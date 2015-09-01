'use strict';

// mocha defines to avoid JSHint breakage
/* global describe, it, before, beforeEach, after, afterEach */

var assert = require('../utils/assert.js');
var server = require('../utils/server.js');
var preq   = require('preq');
var P = require('bluebird');

describe('post_data', function () {
    this.timeout(20000);

    before(function () { return server.start(); });

    it('should store post request by hash', function() {
        return preq.post({
            uri: server.config.baseURL + '/post_data/storage',
            headers: {
                test: 'test'
            },
            body: {
                key: 'value'
            }
        })
        .then(function(res) {
            assert.deepEqual(res.status, 201);
            assert.deepEqual(res.body, 'd0d450a2edc686eeb122b5d9192116ed6285cc5c');
            return preq.get({
                uri: server.config.baseURL + '/post_data/storage/' + res.body
            });
        })
        .then(function(res) {
            console.log(res);
            assert.deepEqual(res.status, 200);
            assert.deepEqual(res.body.body, { key: 'value' });
            assert.deepEqual(res.body.headers.test, 'test');
        });
    });
});
