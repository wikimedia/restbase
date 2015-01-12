'use strict';

// mocha defines to avoid JSHint breakage
/* global describe, it, before, beforeEach, after, afterEach */

var assert = require('../../utils/assert.js');
var preq = require('preq');

module.exports = function (config) {

    describe('pagecontent bucket handler', function() {
        it('should allow the latest format to be submitted', function() {
            this.timeout(20000);
            return preq.put({
                uri: config.bucketURL + '/Main_Page/html',
                headers: { 'content-type': 'text/html' },
                body: 'this is the latest'
            })
            .then(function(res) {
                assert.deepEqual(res.status, 201);
                return preq.get({
                  uri: config.bucketURL + '/Main_Page/html/' + res.headers.etag,
                });
            })
            .then(function(res) {
                assert.deepEqual(res.status, 200);
                assert.deepEqual(res.body, 'this is the latest');
            });
        });
    });

};
