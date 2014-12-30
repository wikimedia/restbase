"use strict";

/*
 * Static utility methods for RESTBase
 */

var util = require('util');
var url = require('url');
var Busboy = require('busboy');
var uuid = require('node-uuid');
var bunyan = require('bunyan');
var gelf_stream = require('gelf-stream');
var dgram = require( 'dgram' );
var StatsD = require('node-txstatsd');

var rbUtil = {};

// Timer that can report to StatsD
rbUtil.StatsD = function ( statsdHost, statsdPort ) {
    var timers = {};
    var statsd = new StatsD(
            statsdHost,
            statsdPort,
            'restbase.routes.',
            '',
            true,  // is txstatsd
            false, // Don't globalize, we're doing that here
            true  // Do cache DNS queries
    );

    function makeName(name) {
        // See https://github.com/etsy/statsd/issues/110
        // Only [\w_.-] allowed, with '.' being the hierarchy separator.
        return name.replace( /[^\/a-zA-Z0-9\.\-]/g, '-' )
                   .replace(/\//g, '_');
    }

    this.startTimer = function (name) {
        timers[name] = new Date();
    };

    this.stopTimer = function (name, suffix) {
        var startTime = timers[name];
        if (!startTime) {
            throw new Error('Tried to stop a timer that does not exist: ' + name);
        }
        var delta = new Date() - startTime;

        name = makeName(name);
        if (Array.isArray(suffix)) {
            // Send several timings at once
            var stats = suffix.map(function(s) {
                return name + (s ? '.' + s : '');
            });
            statsd.sendAll(stats, delta, 'ms');
        } else {
            suffix = suffix ? '.' + suffix : '';
            statsd.timing(makeName(name) + suffix, delta);
        }
        return delta;
    };

    this.count = function (name, suffix) {
        suffix = suffix ? '.' + suffix : '';
        statsd.increment(makeName(name) + suffix);
    };
};

// Optimized URL parsing
var qs = require('querystring');
// Should make it into 0.12, see https://github.com/joyent/node/pull/7878
var SIMPLE_PATH = /^(\/(?!\/)[^\?#\s]*)(\?[^#\s]*)?$/;
rbUtil.parseURL = function parseURL (uri) {
    // Fast path for simple path uris
    var fastMatch = SIMPLE_PATH.exec(uri);
    if (fastMatch) {
        return {
            protocol: null,
            slashes: null,
            auth: null,
            host: null,
            port: null,
            hostname: null,
            hash: null,
            search: fastMatch[2] || '',
            pathname: fastMatch[1],
            path: fastMatch[1],
            query: fastMatch[2] && qs.parse(fastMatch[2]) || {},
            href: uri
        };
    } else {
        return url.parse(uri, true);
    }
};

// Parse a POST request into request.body with BusBoy
// Drops file uploads on the floor without creating temporary files
//
// @param {request} HTTP request
// @returns {Promise<>}

function read(req) {
    return new Promise(function (resolve) {
        var chunks = [];
        req.on('data', function(chunk) {
            chunks.push(chunk);
        });

        req.on('end', function() {
            req.body = Buffer.concat(chunks);
            resolve();
        });
    });
}

rbUtil.parsePOST = function parsePOST(req) {

    var readIt =
        (req.method === 'PUT') ||
        (req.method === 'POST' && req.headers &&
         /^application\/json/i.test(req.headers['content-type']));

    if (readIt) {
        return read(req);
    } else if (req.method !== 'POST') {
        return Promise.resolve();
    } else {
        var headers = req.headers;
        if (!headers['content-type']) {
            headers = {
                'content-type': 'application/binary'
            };
        }

        return new Promise(function(resolve) {
            // Parse POST data
            var bboy = new Busboy({
                headers: headers,
                // Increase the form field size limit from the 1M default.
                limits: { fieldSize: 15 * 1024 * 1024 }
            });
            req.body = req.body || {};
            bboy.on('field', function (field, val) {
                req.body[field] = val;
            });
            bboy.on('finish', function () {
                resolve();
            });
            req.pipe(bboy);
        });
    }
};

rbUtil.reverseDomain = function reverseDomain (domain) {
    return domain.toLowerCase().split('.').reverse().join('.');
};

rbUtil.tidFromDate = function tidFromDate(date) {
    // Create a new, deterministic timestamp
    return uuid.v1({
        node: [0x01, 0x23, 0x45, 0x67, 0x89, 0xab],
        clockseq: 0x1234,
        msecs: date.getTime(),
        nsecs: 0
    });
};

rbUtil.extend = require('extend');

var levels = ['trace','debug','info','warn','error','fatal'];
function levelToMatcher (level) {
    var pos = levels.indexOf(level);
    if (pos !== -1) {
        return new RegExp('^(' + levels.slice(pos).join('|') + ')(?=\/|$)');
    } else {
        // Match nothing
        return /^$/;
    }
}

// Simple bunyan logger wrapper
function Logger (conf, logger) {
    this.conf = conf;
    this.logger = logger || bunyan.createLogger(conf);
    this.level = conf && conf.level || 'warn';
    this.levelMatcher = levelToMatcher(this.level);
}



Logger.prototype.log = function (level) {
    var levelMatch = this.levelMatcher.exec(level);
    if (levelMatch) {
        var logger = this.logger;
        var simpleLevel = levelMatch[1];
        var params = Array.prototype.slice.call(arguments, 1);
        if (params.length && params[0] && typeof params[0] === 'object') {
            // Got an object, inject the detailed levelpath.
            // 'level' is already used for the numeric level.
            params[0].levelPath = level;
        }
        logger[simpleLevel].apply(logger, params);
    }
};

rbUtil.makeLogger = function(conf) {
    if (Array.isArray(conf.streams)) {
        var streams = [];
        conf.streams.forEach(function(stream) {
            if (stream.type === 'gelf') {
                // Convert the 'gelf' logger type to a real logger
                streams.push({
                    type: 'raw',
                    stream: gelf_stream.forBunyan(stream.host,
                        stream.port, stream.options)
                });
            } else {
                streams.push(stream);
            }
        });
        conf = rbUtil.extend({}, conf);
        conf.streams = streams;
    }
    var newLogger = new Logger(conf);
    function bindAndChild (logger) {
        var log = logger.log.bind(logger);
        log.child = function(args) {
            return bindAndChild(new Logger(null, logger.logger.child(args)));
        };
        return log;
    }
    var res = bindAndChild(newLogger);

    // Avoid recursion if there are bugs in the logging code.
    var inLogger = false;

    function logUnhandledException (err) {
        if (!inLogger) {
            inLogger = true;
            res('error/restbase/unhandled',  err);
            inLogger = false;
        }
    }

    // Catch unhandled rejections & log them. This relies on bluebird.
    Promise.onPossiblyUnhandledRejection(logUnhandledException);

    // Similarly, log uncaught exceptions. Also, exit.
    process.on('uncaughtException', function(err) {
        logUnhandledException(err);
        process.exit(1);
    });
    return res;
};

/*
 * Error instance wrapping HTTP error responses
 *
 * Has the same properties as the original response.
 */
function HTTPError(response) {
    Error.call(this);
    Error.captureStackTrace(this, HTTPError);
    this.name = this.constructor.name;
    this.message = JSON.stringify(response);

    for (var key in response) {
        this[key] = response[key];
    }
}
util.inherits(HTTPError, Error);

rbUtil.HTTPError = HTTPError;


module.exports = rbUtil;
