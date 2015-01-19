'use strict';

// mocha defines to avoid JSHint breakage
/* global describe, it, before, beforeEach, after, afterEach */

var server = require('./utils/server.js');
var assert = require('./utils/assert.js');
var preq   = require('preq');

describe('PHP action API service', function() {
    this.timeout(20000);

    before(function () { return server.start(); });

    it('should accept form-based POST requests', function() {
        return preq.post({
            uri: server.config.hostPort + '/v1/en.wikipedia.org/_svc/action/query',
            headers: {
                host: 'en.wikipedia.org',
                'content-type': 'application/x-www-form-urlencoded'
            },
            body: 'format=json&action=query&titles=Monads'
        })
        .then(function(res) {
            assert.deepEqual(res.status, 200);
            assert.deepEqual(res.body.items, [{
                'pageid': 2834759,
                'ns': 0,
                'title': 'Monads'
            }]);
        });
    });

});
