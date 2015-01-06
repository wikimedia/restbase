'use strict';

// mocha defines to avoid JSHint breakage
/* global describe, it, before, beforeEach, after, afterEach */

var preq   = require('preq');
var assert = require('../../utils/assert.js');

module.exports = function (config) {

    describe('non-existing api', function() {

        it('should return a 500 when trying to query a non-existing api', function() {
            this.timeout(20000);
            return assert.fails(
                preq.get({
                    uri: config.hostPort + '/v1/www.wikimedia.org/_svc/action/query',
                    headers: { host: 'en.wikipedia.org' }
                }),
                function(e) {
                    assert.deepEqual(e.status, 500);
                    assert.deepEqual(e.body.query, undefined);
                    assert.deepEqual(e.body.pages, undefined);
                }
            );
        });

        it('should return a 500 when a query returns no results', function() {
            this.timeout(20000);
            return assert.fails(
                preq.get({
                    uri: config.hostPort + '/v1/en.wikipedia.org/_svc/action/query',
                    headers: { host: 'en.wikipedia.org' }
                }),
                function(e) {
                    assert.deepEqual(e.status, 500);
                    assert.deepEqual(e.body.query, undefined);
                    assert.deepEqual(e.body.pages, undefined);
                }
            );
        });

    });

};
