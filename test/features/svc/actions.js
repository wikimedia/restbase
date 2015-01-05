'use strict';

// mocha defines to avoid JSHint breakage
/* global describe, it, before, beforeEach, after, afterEach */

var preq   = require('preq');
var assert = require('../../utils/assert.js');

module.exports = function (config) {

    describe('non-existing api', function() {

        it('should return a 404 when trying to query a non-existing api', function() {
            this.timeout(20000);
            return preq.get({
                uri: config.hostPort + '/v1/www.wikimedia.org/_svc/action/query',
                headers: { host: 'en.wikipedia.org' }
            })
            .catch(function(e) {
                assert.deepEqual(e.status, 404);
            });
        });

        it('should return a 200 even when a query returns no results', function() {
            this.timeout(20000);
            return preq.get({
                uri: config.hostPort + '/v1/en.wikipedia.org/_svc/action/query',
                headers: { host: 'en.wikipedia.org' }
            })
            .then(function(res) {
                assert.deepEqual(res.status, 200);
                assert.deepEqual(res.body.query, undefined);
                assert.deepEqual(res.body.pages, undefined);
            });
        });

    });

};
