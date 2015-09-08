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

    var hash = '';

    it('should store post request by hash', function() {
        return preq.post({
            uri: server.config.baseURL + '/post_data/storage',
            body: {
                key: 'value'
            }
        })
        .then(function(res) {
            hash = res.body;
            assert.deepEqual(res.status, 201);
            assert.deepEqual(hash, 'da55e962e0a013118a220cccc64ea663d24c3263');
            return preq.get({
                uri: server.config.baseURL + '/post_data/storage/' + res.body
            });
        })
        .then(function(res) {
            assert.deepEqual(res.status, 200);
            assert.deepEqual(res.body.body, { key: 'value' });
        });
    });

    it('should not store identical request', function() {
        return preq.post({
            uri: server.config.baseURL + '/post_data/storage',
            body: {
                key: 'value'
            }
        })
        .then(function(res) {
            assert.deepEqual(res.status, 200);
            assert.deepEqual(res.body, hash);
        });
    });
});
