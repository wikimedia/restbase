'use strict';

var assert = require('../utils/assert.js');
var Server = require('../utils/server.js');
var preq = require('preq');

// mocha defines to avoid JSHint breakage
/* global describe, it, before, beforeEach, after, afterEach */

describe('Handler Template', function() {
    var server = new Server('test/framework/streaming/test_config.yaml');
    before(function() { return server.start(); });

    it('Basic streaming', function () {
        return preq.get({ uri: server.hostPort + '/test/hello' })
        .then(function (res) {
            assert.deepEqual(res.status, 200);
            assert.deepEqual(res.headers['content-type'], 'text/html');
            assert.deepEqual(res.body, 'hello');
        });
    });

    it('Buffer streaming', function () {
        return preq.get({ uri: server.hostPort + '/test/buffer' })
        .then(function (res) {
            assert.deepEqual(res.status, 200);
            assert.deepEqual(res.headers['content-type'], 'text/html');
            assert.deepEqual(res.body, 'hello');
        });
    });

    it('Buffer streaming, no compression', function () {
        return preq.get({
            uri: server.hostPort + '/test/buffer',
            gzip: false
        })
        .then(function (res) {
            assert.deepEqual(res.status, 200);
            assert.deepEqual(res.headers['content-type'], 'text/html');
            assert.deepEqual(res.body, 'hello');
        });
    });

    it('Multi-chunk streaming', function () {
        return preq.get({ uri: server.hostPort + '/test/chunks' })
        .then(function (res) {
            assert.deepEqual(res.status, 200);
            assert.deepEqual(res.headers['content-type'], 'text/html');
            if (!/^0123456.*99$/.test(res.body)) {
                throw new Error('Expected the body to match /^0123456.*99$/');
            }
        });
    });

    after(function() { return server.stop(); });
});
