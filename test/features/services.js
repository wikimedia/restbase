'use strict';

// mocha defines to avoid JSHint breakage
/* global describe, it, before, beforeEach, after, afterEach */

var assert = require('../utils/assert.js');
var preq = require('preq');
var URI = require('swagger-router').URI;

module.exports = function (config) {

    describe('PHP action API service', function() {
        it('should accept form-based POST requests', function() {
            return preq.post({
                uri: new URI([config.hostPort,'sys','action','query']),
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

};
