'use strict';

/*
 * Simple API tests
 */

/*
 * Could also check out the nock package to record / replay http interactions
 */

// mocha defines to avoid JSHint breakage
/* global describe, it, before, beforeEach, after, afterEach */

require('mocha-jshint')(); // run JSHint as part of testing

var restbase = require('../lib/server.js');
var dir      = require('./utils/dir');

var hostPort  = 'http://localhost:7231';
var baseURL   = hostPort + '/v1/en.wikipedia.test.local';
var bucketURL = baseURL + '/pages';

var config = {
    hostPort: hostPort,
    baseURL: baseURL,
    bucketURL: bucketURL
};

var stopRestbase = function () {};

var log = {};
function logger() {
    function collect(context) {
        return function() {
            var ctx = JSON.stringify(context);
            if (/^warn/.test(arguments[0]) ||
                /^error/.test(arguments[0]) ||
                /^fatal/.test(arguments[0])
            ) {
                log[ctx] = log[ctx] || [];
                log[ctx].push(arguments);
            }
            return collect(context);
        };
    }
    var collector = collect('root');
    collector.child = collect;
    return collector;
}

function startRestbase(offline) {
    stopRestbase();
    offline = offline || false;
    return restbase({
        logging: {
            logger: logger()
        },
        offline: offline
    }).then(function(server){
        stopRestbase =
            function () {
                console.log('stopping restbase');
                server.close();
                stopRestbase = function () {};
            };
    });
}

describe('API feature tests', function () {
    this.timeout(20000);
    before(function () { return startRestbase(); });

    dir.walk(__dirname + '/features/').forEach(function (file) {
        if (/\.js$/.test(file)) {
            require(file)(config);
        }
    });

    after(function () { return stopRestbase(); });
});

describe('Offline mode feature tests after a server restart', function() {
    this.timeout(20000);
    before(function () { return startRestbase(true); });

    var assert = require('./utils/assert.js');
    var preq = require('preq');

    var offlineMessage = 'We are offline, but your request needs to be serviced online.';

    describe('offline mode', function() {
        it('should allow content revision retrieval from storage', function() {
            this.timeout(20000);
            return preq.get({
                uri: config.bucketURL + '/Idempotent/html/76f22880-362c-11e4-9234-0123456789ab'
            })
            .then(function(res) {
                assert.deepEqual(res.status, 200);
            });
        });
        it('should not allow latest content retrieval from storage', function() {
            this.timeout(20000);
            return assert.fails(
                preq.get({
                    uri: config.bucketURL + '/Idempotent/html'
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
                    uri: config.baseURL + '/_svc/parsoid/Monads/1'
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
                    uri: config.hostPort + '/v1/en.wikipedia.org/_svc/action/query',
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

    after(function () { return stopRestbase(); });
});

describe('Log', function () {

    var assert = require('./utils/assert.js');

    this.timeout(20000);


    it('should only have PUT, GET, and POST request entries', function() {
        assert.deepEqual(Object.keys(log), [
            '{"req":{"method":"GET"}}',
            '{"req":{"method":"POST"}}'
        ]);
    });

    it('should have some GET request entries', function() {
        assert.deepEqual(log['{"req":{"method":"GET"}}'].length, 4);
    });

    it('should have some POST request entries', function() {
        assert.deepEqual(log['{"req":{"method":"POST"}}'].length, 1);
    });

});
