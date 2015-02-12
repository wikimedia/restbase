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
var TXStatsD = require('node-txstatsd');


// StatsD wrapper
function StatsD(statsdHost, statsdPort) {
    this.statsd = new TXStatsD({
        host: statsdHost,
        port: statsdPort,
        prefix: 'restbase.routes.',
        suffix: '',
        txstatsd  : true,
        globalize : false,
        cacheDns  : true,
        mock      : false
    });

    this.nameCache = {};
}

StatsD.prototype.makeName = function makeName(name) {
    // See https://github.com/etsy/statsd/issues/110
    // Only [\w_.-] allowed, with '.' being the hierarchy separator.
    var res = this.nameCache[name];
    if (res) {
        return res;
    } else {
        this.nameCache[name] = name.replace( /[^\/a-zA-Z0-9\.\-]/g, '-' )
               .replace(/\//g, '_');
        return this.nameCache[name];
    }
};

StatsD.prototype.timing = function timing(name, suffix, delta) {
    name = this.makeName(name);
    if (Array.isArray(suffix)) {
        // Send several timings at once
        var stats = suffix.map(function(s) {
            return name + (s ? '.' + s : '');
        });
        this.statsd.sendAll(stats, delta, 'ms');
    } else {
        suffix = suffix ? '.' + suffix : '';
        this.statsd.timing(this.makeName(name) + suffix, delta);
    }
    return delta;
};

StatsD.prototype.count = function count(name, suffix) {
    suffix = suffix ? '.' + suffix : '';
    this.statsd.increment(this.makeName(name) + suffix);
};



var rbUtil = {};

rbUtil.StatsD = StatsD;

// Optimized URL parsing
var qs = require('querystring');
// Should make it into 0.12, see https://github.com/joyent/node/pull/7878
var SIMPLE_PATH = /^(\/(?!\/)[^\?#\s]*)(?:\?([^#\s]*))?$/;
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
            return Buffer.concat(chunks);
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
        // Parse the POST
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
            var body = {};
            bboy.on('field', function (field, val) {
                body[field] = val;
            });
            bboy.on('finish', function () {
                resolve(body);
            });
            req.pipe(bboy);
        });
    }
};

rbUtil.reverseDomain = function reverseDomain (domain) {
    return domain.toLowerCase().split('.').reverse().join('.');
};

rbUtil.tidFromDate = function tidFromDate(date) {
    if (typeof date === 'object') {
        // convert Date object to numeric milliseconds
        date = date.getTime();
    } else if (typeof date === 'string') {
        // convert date string to numeric milliseconds
        date = Date.parse(date);
    }
    if (isNaN(+date)) {
        throw new Error('Invalid date');
    }
    // Create a new, deterministic timestamp
    return uuid.v1({
        node: [0x01, 0x23, 0x45, 0x67, 0x89, 0xab],
        clockseq: 0x1234,
        msecs: +date,
        nsecs: 0
    });
};

var uuidRe = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
/**
 * Check if a string is a valid timeuuid
 */
rbUtil.isTimeUUID = function (s) {
    return uuidRe.test(s);
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
function Logger (conf, logger, args) {
    this.conf = conf;
    this.logger = logger || bunyan.createLogger(conf);
    this.level = conf && conf.level || 'warn';
    this.levelMatcher = levelToMatcher(this.level);
    this.args = args;
}



Logger.prototype.log = function (level) {
    var levelMatch = this.levelMatcher.exec(level);
    if (levelMatch) {
        var logger = this.logger;
        var simpleLevel = levelMatch[1];
        var params = Array.prototype.slice.call(arguments, 1);
        if (params.length && params[0] && typeof params[0] === 'object') {
            // Got an object
            //
            // Inject the detailed levelpath.
            // 'level' is already used for the numeric level.
            params[0].levelPath = level;

            // Also pass in default parameters
            params[0] = rbUtil.extend({}, this.args, params[0]);
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
            return bindAndChild(new Logger(conf, logger.logger, args));
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
    this.message = response.status + '';
    if (response.body && response.body.type) {
        this.message += ': ' + response.body.type;
    }

    for (var key in response) {
        this[key] = response[key];
    }
}
util.inherits(HTTPError, Error);

rbUtil.HTTPError = HTTPError;

rbUtil.httpErrors = {
    notFound: function(description) {
        return new HTTPError({
            status: 404,
            type: 'notfound',
            title: 'Not found',
            description: description
        });
    },
    server: function(description) {
        return new HTTPError({
            status: 500,
            type: 'server',
            title: 'Server error',
            description: description
        });
    }
};


module.exports = rbUtil;
