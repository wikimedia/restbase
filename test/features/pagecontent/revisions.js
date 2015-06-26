'use strict';

// mocha defines to avoid JSHint breakage
/* global describe, it, before, beforeEach, after, afterEach */

var assert = require('../../utils/assert.js');
var preq   = require('preq');
var server = require('../../utils/server.js');
var P = require('bluebird');
var pagingToken = '';

describe('revision requests', function() {

	var revOk = 642497713;
	var revDeleted = 645504917;
	var revRedirect = 591082967;
    var pageName = 'User:GWicke%2fDate';
    var pageLastRev = 653530930;

    this.timeout(20000);

    before(function () { return server.start(); });

    it('should return valid revision info', function() {
        return preq.get({ uri: server.config.bucketURL + '/revision/' + revOk })
        .then(function(res) {
            assert.deepEqual(res.status, 200);
            assert.deepEqual(res.body.items.length, 1);
            assert.deepEqual(res.body.items[0].rev, revOk);
            assert.deepEqual(res.body.items[0].title, 'Foobar');
            assert.deepEqual(res.body.items[0].page_id, '11178');
            assert.deepEqual(res.body.items[0].redirect, false);
        });
    });

    it('should return redirect true when included', function() {
        return preq.get({ uri: server.config.bucketURL + '/revision/' + revRedirect })
        .then(function(res) {
            assert.deepEqual(res.status, 200);
            assert.deepEqual(res.body.items.length, 1);
            assert.deepEqual(res.body.items[0].rev, revRedirect);
            assert.deepEqual(res.body.items[0].redirect, true);
        });
    });

    it('should query the MW API for revision info', function() {
        var slice = server.config.logStream.slice();
        return preq.get({
            uri: server.config.bucketURL + '/revision/' + revOk,
            headers: { 'cache-control': 'no-cache' }
        })
        .then(function(res) {
            slice.halt();
            assert.deepEqual(res.status, 200);
            assert.deepEqual(res.body.items.length, 1);
            assert.deepEqual(res.body.items[0].rev, revOk);
            assert.deepEqual(res.body.items[0].title, 'Foobar');
            assert.remoteRequests(slice, true);
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

    it('should query the MW API for a non-existent revision and return a 404', function() {
        var slice = server.config.logStream.slice();
        return preq.get({ uri: server.config.bucketURL + '/revision/0' })
        .then(function(res) {
            slice.halt();
            throw new Error('Expected status 404 for an invalid revision, got ' + res.status);
        },
        function(res) {
            slice.halt();
            assert.deepEqual(res.status, 404);
            assert.remoteRequests(slice, true);
        });
    });

    it('should fail for a restricted revision fetched from MW API', function() {
        return preq.get({
            uri: server.config.bucketURL + '/revision/' + revDeleted,
            headers: { 'cache-control': 'no-cache' }
        })
        .then(function(res) {
            throw new Error('Expected status 403 for a restricted revision, got ' + res.status);
        },
        function(res) {
            assert.deepEqual(res.status, 403);
        });
    });

    it('should fail for a restricted revision present in storage', function() {
        return preq.get({ uri: server.config.bucketURL + '/revision/' + revDeleted })
        .then(function(res) {
            throw new Error('Expected status 403 for a restricted revision, got ' + res.status);
        },
        function(res) {
            assert.deepEqual(res.status, 403);
        });
    });

    it('should list stored revisions', function() {
        return preq.get({ uri: server.config.bucketURL + '/revision/' })
        .then(function(res) {
            assert.deepEqual(res.status, 200);
            assert.contentType(res, 'application/json');
            if (!res.body.items || !res.body.items.length) {
                throw new Error("No revisions returned!");
            }
            if (typeof res.body.items[0] !== 'number') {
                throw new Error("Expected a numeric revision id!");
            }
            pagingToken = res.body._links.next.href;
        });
    });

    it('should list next set of stored revisions using pagination', function() {
        return preq.get({ uri: server.config.bucketURL + '/revision/' + pagingToken })
        .then(function(res) {
            assert.deepEqual(res.status, 200);
            assert.contentType(res, 'application/json');
            if (!res.body.items || !res.body.items.length) {
                throw new Error("No revisions returned!");
            }
            if (typeof res.body.items[0] !== 'number') {
                throw new Error("Expected a numeric revision id!");
            }
        })
    });

    it('should return latest revision for a page', function () {
        return preq.get({uri: server.config.bucketURL + '/title/' + pageName + '/latest'})
            .then(function (res) {
                assert.deepEqual(res.status, 200);
                assert.deepEqual(res.body.items.length, 1);
                assert.deepEqual(res.body.items[0].rev, pageLastRev);
            });
    });
});

