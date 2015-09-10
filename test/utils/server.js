'use strict';

// mocha defines to avoid JSHint breakage
/* global describe, it, before, beforeEach, after, afterEach */

var ServiceRunner = require('service-runner');
var dir       = require('./dir');
var logStream = require('./logStream');
var fs        = require('fs');
var assert    = require('./assert');
var yaml      = require('js-yaml');

var hostPort  = 'http://localhost:7231';
var baseURL   = hostPort + '/en.wikipedia.org/v1';
var bucketURL = baseURL + '/page';
var secureURL = hostPort + '/fr.wikipedia.org/v1/page';
var labsURL   = hostPort + '/en.wikipedia.beta.wmflabs.org/v1/page';

function loadConfig(path) {
    var confString = fs.readFileSync(path).toString();
    var backendImpl = process.env.RB_TEST_BACKEND;
    if (backendImpl) {
        if (backendImpl !== 'cassandra' && backendImpl !== 'sqlite') {
            throw new Error('Invalid RB_TEST_BACKEND env variable value. Allowed values: "cassandra", "sqlite"');
        }
        if (backendImpl === 'sqlite') {
            confString = confString.replace('restbase-mod-table-cassandra', 'restbase-mod-table-sqlite')
        }
    }
    return yaml.safeLoad(confString);
}

var config = {
    hostPort: hostPort,
    baseURL: baseURL,
    bucketURL: bucketURL,
    secureURL: secureURL,
    labsURL: labsURL,
    logStream: logStream(),
    conf: loadConfig(__dirname + '/../../config.test.yaml')
};

config.conf.num_workers = 0;
config.conf.logging = {
    name: 'restbase-tests',
    level: 'trace',
    stream: config.logStream
};

var stop    = function () {};
var isRunning;
var options = null;
var runner = new ServiceRunner();

function start(_options) {
    _options = _options || {};

    if (!assert.isDeepEqual(options, _options) || !isRunning) {
        console.log('server options changed; restarting');
        stop();
        options = _options;
        console.log('starting restbase in '
                + (options.offline ? 'OFFLINE' : 'ONLINE') + ' mode');
        config.conf.offline = options.offline || false;

        return runner.run(config.conf)
        .then(function(servers){
            var server = servers[0];
            isRunning = true;
            stop =
                function () {
                    console.log('stopping restbase');
                    isRunning = false;
                    server.close();
                    stop = function () {};
                };
            return true;
        });
    } else {
        return Promise.resolve();
    }
}

module.exports.config = config;
module.exports.start  = start;
module.exports.stop   = function() { stop() };
module.exports.loadConfig = loadConfig;
