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

function startRestbase(offline) {
    stopRestbase();
    offline = offline || false;
    console.log('starting restbase in ' + (offline ? 'OFFLINE' : 'ONLINE') + ' mode');
    return restbase({
        logging: {
            name: 'restbase-tests',
            level: 'warn',
            offline: offline
        }
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
        require(file)(config);
    });

    after(function () { return stopRestbase(); });
});

describe('Offline mode feature tests after a server restart', function() {
    this.timeout(20000);
    before(function () { return startRestbase(true); });

    require('./features/pagecontent/idempotent')(config);

    after(function () { return stopRestbase(); });
});
