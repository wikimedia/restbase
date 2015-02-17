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
var baseURL   = hostPort + '/en.wikipedia.test.local/v1';
var bucketURL = baseURL + '/page';

var config = {
    hostPort: hostPort,
    baseURL: baseURL,
    bucketURL: bucketURL,
    logStream: logStream(),
    conf: yaml.safeLoad(fs.readFileSync(__dirname + '/../../config.example.yaml')),
};
config.conf.num_workers = 0;
config.conf.logging = {
    name: 'restbase-tests',
    level: 'trace',
    stream: config.logStream
};

var stop    = function () {};
var options = null;
var runner = new ServiceRunner();

function start(_options) {
    _options = _options || {};

    if (!assert.isDeepEqual(options, _options)) {
        console.log('server options changed; restarting');
        stop();
        options = _options;
        console.log('starting restbase in '
                + (options.offline ? 'OFFLINE' : 'ONLINE') + ' mode');
        config.conf.offline = options.offline || false;

        return runner.run(config.conf)
        .then(function(servers){
            var server = servers[0];
            stop =
                function () {
                    console.log('stopping restbase');
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
