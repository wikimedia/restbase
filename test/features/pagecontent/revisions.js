'use strict';

// mocha defines to avoid JSHint breakage
/* global describe, it, before, beforeEach, after, afterEach */

var assert = require('../../utils/assert.js');
var preq   = require('preq');
var server = require('../../utils/server.js');


describe('revision requests', function() {

    this.timeout(20000);

    before(function () { return server.start(); });

    it('should return valid revision info', function() {
        return preq.get({ uri: server.config.bucketURL + '/revision/642497713' })
        .then(function(res) {
            assert.deepEqual(res.status, 200);
            assert.deepEqual(res.body.items.length, 1);
            assert.deepEqual(res.body.items[0].rev, 642497713);
            assert.deepEqual(res.body.items[0].title, 'Foobar');
        });
    });

    it('should fail for an invalid revision', function() {
        return preq.get({ uri: server.config.bucketURL + '/revision/faultyrevid' })
        .then(function(res) {
            throw new Error('Expected status 400 for an invalid revision, got ' + res.status);
        },
        function(res) {
            assert.deepEqual(res.status, 400);
        });
    });

});

