'use strict';

// mocha defines to avoid JSHint breakage
/* global describe, it, before, beforeEach, after, afterEach */

var assert = require('../../utils/assert.js');
var preq = require('preq');

module.exports = function (config) {

    describe('item requests', function() {
        it('should respond to OPTIONS request with CORS headers', function() {
            this.timeout(20000);
            return preq.options({ uri: config.bucketURL + '/Foobar/html/624484477' })
            .then(function(res) {
                assert.deepEqual(res.status, 200);
                assert.deepEqual(res.headers['access-control-allow-origin'], '*');
                assert.deepEqual(res.headers['access-control-allow-methods'], 'GET');
                assert.deepEqual(res.headers['access-control-allow-headers'], 'accept, content-type');
            });
        });
        it('should transparently create a new HTML revision with id 624484477', function() {
            this.timeout(20000);
            return preq.get({
                uri: config.bucketURL + '/Foobar/html/624484477',
                body: 'Hello there'
            })
            .then(function(res) {
                assert.deepEqual(res.status, 200);
            });
        });
        it('should transparently create data-parsoid with id 624165266, rev 2', function() {
            this.timeout(20000);
            return preq.get({
                uri: config.bucketURL + '/Foobar/html/624165266'
            })
            .then(function(res) {
                assert.deepEqual(res.status, 200);
            });
        });
        it('should return HTML just created by revision 624165266', function() {
            return preq.get({
                uri: config.bucketURL + '/Foobar/html/624165266'
            })
            .then(function(res) {
                assert.deepEqual(res.status, 200);
                assert.deepEqual(res.headers['content-type'], 'text/html; charset=UTF-8');
            });
        });
        it('should return data-parsoid just created by revision 624165266, rev 2', function() {
            return preq.get({
                uri: config.bucketURL + '/Foobar/data-parsoid/624165266'
            })
            .then(function(res) {
                assert.deepEqual(res.status, 200);
                assert.deepEqual(res.headers['content-type'], 'application/json; profile=mediawiki.org/specs/data-parsoid/1.0');
            });
        });

        it('should return data-parsoid just created with revision 624484477, rev 2', function() {
            return preq.get({
                uri: config.bucketURL + '/Foobar/data-parsoid/624484477'
            })
            .then(function(res) {
                assert.deepEqual(res.status, 200);
                assert.deepEqual(res.headers['content-type'], 'application/json; profile=mediawiki.org/specs/data-parsoid/1.0');
            });
        });

        //it('should return a new wikitext revision using proxy handler with id 624165266', function() {
        //    this.timeout(20000);
        //    return preq.get({
        //        uri: config.baseURL + '/test/Foobar/wikitext/624165266'
        //    })
        //    .then(function(res) {
        //        assert.deepEqual(res.status, 200);
        //    });
        //});

    });

    describe('pagecontent bucket', function() {
        it('should provide bucket info', function() {
            this.timeout(20000);
            return preq.get({
                uri: config.bucketURL,
            })
            .then(function(res) {
                assert.deepEqual(res.status, 200);
            });
        });
        it('should list its contents', function() {
            this.timeout(20000);
            return preq.get({
                uri: config.bucketURL + '/',
            })
            .then(function(res) {
                assert.deepEqual(res.status, 200);
            });
        });
    });

    describe('pagecontent/html bucket', function() {
        it('should provide bucket info', function() {
            this.timeout(20000);
            return preq.get({
                uri: config.bucketURL + '.html',
            })
            .then(function(res) {
                assert.deepEqual(res.status, 200);
            });
        });
        it('should list its contents', function() {
            this.timeout(20000);
            return preq.get({
                uri: config.bucketURL + '.html/',
            })
            .then(function(res) {
                assert.deepEqual(res.status, 200);
            });
        });
    });
};
