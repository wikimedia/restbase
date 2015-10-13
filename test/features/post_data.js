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
            uri: server.config.baseURL + '/post_data/',
            body: {
                key: 'value'
            }
        })
        .then(function(res) {
            hash = res.body;
            assert.deepEqual(res.status, 201);
            assert.deepEqual(hash, '228458095a9502070fc113d99504226a6ff90a9a');
            return preq.get({
                uri: server.config.baseURL + '/post_data/' + res.body
            });
        })
        .then(function(res) {
            assert.deepEqual(res.status, 200);
            assert.deepEqual(res.body, { key: 'value' });
        });
    });

    it('should not store identical request', function() {
        return preq.post({
            uri: server.config.baseURL + '/post_data/',
            body: {
                key: 'value'
            }
        })
        .then(function(res) {
            assert.deepEqual(res.status, 200);
            assert.deepEqual(res.body, hash);
        });
    });

    it('should allow read on remote request', function() {
        return preq.get({
            uri: server.config.baseURL + '/post_data/' + hash
        })
        .then(function(res) {
            assert.deepEqual(res.status, 200);
            assert.deepEqual(res.body, { key: 'value' });
        })
    });

    it('should deny write on remote requests', function() {
        return preq.post({
            uri: server.config.baseURL + '/post_data/',
            headers: {
                'x-client-ip': '123.123.123.123'
            },
            body: {
                key: 'value2'
            }
        })
        .then(function() {
            throw new Error('Error should be thrown');
        }, function(e) {
            assert.deepEqual(e.status, 403);
        });
    });
});
