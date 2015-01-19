'use strict';

// mocha defines to avoid JSHint breakage
/* global describe, it, before, beforeEach, after, afterEach */

var server = require('../utils/server.js');
var assert = require('../utils/assert.js');
var preq = require('preq');

describe('idempotent item requests', function() {
    this.timeout(20000);

    before(function () { return server.start(); });

    it('should accept a new html save with a revision', function() {
        return preq.put({
            uri: server.config.bucketURL + '/Idempotent/html/76f22880-362c-11e4-9234-0123456789ab',
            headers: { 'content-type': 'text/html;profile=mediawiki.org/specs/html/1.0.0' },
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
            uri: server.config.bucketURL + '/Idempotent/html/76f22880-362c-11e4-9234-0123456789ab'
        })
        .then(function(res) {
            assert.deepEqual(res.status, 200);
            assert.deepEqual(res.headers['content-type'], 'text/html;profile=mediawiki.org/specs/html/1.0.0');
            assert.deepEqual(res.headers.etag, '76f22880-362c-11e4-9234-0123456789ab');
            assert.deepEqual(res.body, 'Hello there');
        });
    });

});
