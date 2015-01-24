'use strict';

// mocha defines to avoid JSHint breakage
/* global describe, it, before, beforeEach, after, afterEach */

var restbase  = require('../../lib/server.js');
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
    spec: yaml.safeLoad(fs.readFileSync(__dirname + '/../../config.example.yaml')).spec,
};

var stop    = function () {};
var options = null;

function start(_options) {
    _options = _options || {};

    if (!assert.isDeepEqual(options, _options)) {
        console.log('server options changed; restarting');
        stop();
        options = _options;
        var offline = (options.offline) || false;
        console.log('starting restbase in ' + (offline ? 'OFFLINE' : 'ONLINE') + ' mode');
        return restbase({
            logging: {
                name: 'restbase-tests',
                level: 'trace',
                stream: config.logStream
            },
            spec: config.spec
        }).then(function(server){
            stop =
                function () {
                    console.log('stopping restbase');
                    server.close();
                    stop = function () {};
                };
            return true;
        });
    }
}

module.exports.config = config;
module.exports.start  = start;
