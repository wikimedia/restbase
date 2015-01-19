'use strict';

/*
 * Could also check out the nock package to record / replay http interactions
 */

// mocha defines to avoid JSHint breakage
/* global describe, it, before, beforeEach, after, afterEach */

require('mocha-jshint')(); // run JSHint as part of testing

var server = require('./utils/server.js');
var assert = require('./utils/assert.js');
var preq = require('preq');

describe('offline mode prerequisites', function() {
    this.timeout(20000);

    before(function () { return server.start(); });

    it('should transparently create a new HTML revision with id 624484477', function() {
        this.timeout(20000);
        return preq.get({
            uri: server.config.bucketURL + '/Foobar/html/624484477',
            body: 'Hello there'
        })
        .then(function(res) {
            assert.deepEqual(res.status, 200);
            server.start({ offline: true });
        });
    });

});

describe('offline mode feature tests after a server restart', function() {
    this.timeout(20000);

    before(function () { return server.start({ offline: true }); });

    var offlineMessage = 'We are offline, but your request needs to be serviced online.';

    it('should transparently create a new HTML revision with id 624484477', function() {
        this.timeout(20000);
        return preq.get({
            uri: server.config.bucketURL + '/Foobar/html/624484477',
            body: 'Hello there'
        })
        .then(function(res) {
            assert.deepEqual(res.status, 200);
        });
    });

    it('should allow content revision retrieval from storage', function() {
        this.timeout(20000);
        return preq.get({
            uri: server.config.bucketURL + '/Foobar/html/76f22880-362c-11e4-9234-0123456789ab'
        })
        .then(function(res) {
            assert.deepEqual(res.status, 200);
        });
    });

    it('should not allow latest content retrieval from storage', function() {
        this.timeout(20000);
        return assert.fails(
            preq.get({
                uri: server.config.bucketURL + '/Foobar/html'
            }),
            function(e) {
                assert.deepEqual(e.status, 500);
                assert.deepEqual(e.body.description, offlineMessage);
            }
        );
    });

    it('should prevent content retrieval from the Web', function() {
        this.timeout(20000);
        return assert.fails(
            preq.get({
                uri: server.config.baseURL + '/_svc/parsoid/Monads/1'
            }),
            function (e) {
                assert.deepEqual(e.status, 500);
                assert.deepEqual(e.body.description, offlineMessage);
            }
        );
    });

    it('should prevent query submission over the Web', function() {
        this.timeout(20000);
        return assert.fails(
            preq.post({
                uri: server.config.hostPort + '/v1/en.wikipedia.org/_svc/action/query',
                headers: { host: 'en.wikipedia.org' },
                body: {
                    format: 'json',
                    action: 'query',
                    titles: 'Main Page',
                    prop: 'revisions',
                    rvprop: 'content'
                }
            }),
            function (e) {
                assert.deepEqual(e.status, 500);
                assert.deepEqual(e.body.description, offlineMessage);
            }
        );
    });

});
