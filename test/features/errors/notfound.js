'use strict';

// mocha defines to avoid JSHint breakage
/* global describe, it, before, beforeEach, after, afterEach */

var assert = require('../../utils/assert.js');
var preq = require('preq');

module.exports = function (config) {

    describe('404 handling', function() {
        it('should return a proper 404 when trying to retrieve a non-existing domain', function() {
            return preq.get({
                uri: config.hostPort + '/v1/foobar.com'
            })
            .catch(function(e) {
                assert.deepEqual(e.status, 404);
                assert.deepEqual(e.headers['content-type'], 'application/problem+json');
            });
        });
        it('should return a proper 404 when trying to list a non-existing domain', function() {
            return preq.get({
                uri: config.hostPort + '/v1/foobar.com/'
            })
            .catch(function(e) {
                assert.deepEqual(e.status, 404);
                assert.deepEqual(e.headers['content-type'], 'application/problem+json');
            });
        });
        it('should return a proper 404 when accessing an unknown bucket', function() {
            return preq.get({
                uri: config.baseURL + '/some_nonexisting_bucket'
            })
            .catch(function(e) {
                assert.deepEqual(e.status, 404);
                assert.deepEqual(e.headers['content-type'], 'application/problem+json');
            });
        });
        it('should return a proper 404 when trying to list an unknown bucket', function() {
            return preq.get({
                uri: config.baseURL + '/some_nonexisting_bucket/'
            })
            .catch(function(e) {
                assert.deepEqual(e.status, 404);
                assert.deepEqual(e.headers['content-type'], 'application/problem+json');
            });
        });
        it('should return a proper 404 when accessing an item in an unknown bucket', function() {
            return preq.get({
                uri: config.baseURL + '/some_nonexisting_bucket/item'
            })
            .catch(function(e) {
                assert.deepEqual(e.status, 404);
                assert.deepEqual(e.headers['content-type'], 'application/problem+json');
            });
        });
        it('should return a proper 404 for the latest revision of a missing page', function() {
            return preq.get({
                uri: config.bucketURL + '/ThisIsProblablyNotARealPateTitle/html'
            })
            .catch(function(e) {
                assert.deepEqual(e.status, 404);
                assert.deepEqual(e.headers['content-type'], 'application/problem+json');
            });
        });
    });

};
