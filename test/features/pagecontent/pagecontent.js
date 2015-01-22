'use strict';

// mocha defines to avoid JSHint breakage
/* global describe, it, before, beforeEach, after, afterEach */

var assert = require('../../utils/assert.js');
var preq   = require('preq');
var server = require('../../utils/server.js');

describe('item requests', function() {
    this.timeout(20000);

    before(function () { return server.start(); });

    it('should respond to OPTIONS request with CORS headers', function() {
        return preq.options({ uri: server.config.bucketURL + '/Foobar/html/624484477' })
        .then(function(res) {
            assert.deepEqual(res.status, 200);
            assert.deepEqual(res.headers['access-control-allow-origin'], '*');
            assert.deepEqual(res.headers['access-control-allow-methods'], 'GET');
            assert.deepEqual(res.headers['access-control-allow-headers'], 'accept, content-type');
        });
    });
    it('should transparently create a new HTML revision with id 624484477', function() {
        return preq.get({
            uri: server.config.bucketURL + '/Foobar/html/624484477',
            body: 'Hello there'
        })
        .then(function(res) {
            assert.deepEqual(res.status, 200);
        });
    });
    it('should transparently create data-parsoid with id 624165266, rev 2', function() {
        return preq.get({
            uri: server.config.bucketURL + '/Foobar/html/624165266'
        })
        .then(function(res) {
            assert.deepEqual(res.status, 200);
        });
    });
    it('should return HTML just created by revision 624165266', function() {
        return preq.get({
            uri: server.config.bucketURL + '/Foobar/html/624165266'
        })
        .then(function(res) {
            assert.deepEqual(res.status, 200);
            assert.deepEqual(res.headers['content-type'], 'text/html;profile=mediawiki.org/specs/html/1.0.0');
        });
    });
    it('should return data-parsoid just created by revision 624165266, rev 2', function() {
        return preq.get({
            uri: server.config.bucketURL + '/Foobar/data-parsoid/624165266'
        })
        .then(function(res) {
            assert.deepEqual(res.status, 200);
            assert.deepEqual(res.headers['content-type'], 'application/json;profile=mediawiki.org/specs/data-parsoid/0.0.1');
        });
    });

    it('should return data-parsoid just created with revision 624484477, rev 2', function() {
        return preq.get({
            uri: server.config.bucketURL + '/Foobar/data-parsoid/624484477'
        })
        .then(function(res) {
            assert.deepEqual(res.status, 200);
            assert.deepEqual(res.headers['content-type'], 'application/json;profile=mediawiki.org/specs/data-parsoid/0.0.1');
        });
    });

    //it('should return a new wikitext revision using proxy handler with id 624165266', function() {
    //    this.timeout(20000);
    //    return preq.get({
    //        uri: server.config.baseURL + '/test/Foobar/wikitext/624165266'
    //    })
    //    .then(function(res) {
    //        assert.deepEqual(res.status, 200);
    //    });
    //});

});

describe('pagecontent bucket', function() {
    this.timeout(20000);
    // TODO: figure out what we'd like to return for /page
    //it('should provide bucket info', function() {
    //    this.timeout(20000);
    //    return preq.get({
    //        uri: server.config.bucketURL,
    //    })
    //    .then(function(res) {
    //        assert.deepEqual(res.status, 200);
    //    });
    //});
    it('should list its contents', function() {
        return preq.get({
            uri: server.config.bucketURL + '/',
        })
        .then(function(res) {
            assert.deepEqual(res.status, 200);
        });
    });
});
