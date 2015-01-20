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

var restbase  = require('../lib/server.js');
var dir       = require('./utils/dir');
var logStream = require('./utils/logStream');
var fs        = require('fs');
var yaml      = require('js-yaml');

var hostPort  = 'http://localhost:7231';
var baseURL   = hostPort + '/en.wikipedia.test.local/v1';
var bucketURL = baseURL + '/page';

var config = {
    hostPort: hostPort,
    baseURL: baseURL,
    bucketURL: bucketURL,
    logStream: logStream(),
    spec: yaml.safeLoad(fs.readFileSync(__dirname + '/../config.example.yaml')).spec,
};

var stopRestbase = function () {};

function startRestbase() {
    stopRestbase();
    console.log('starting restbase');
    return restbase({
        logging: {
            name: 'restbase-tests',
            level: 'trace',
            stream: config.logStream
        },
        spec: config.spec
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
