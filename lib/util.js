"use strict";

/*
 * Static utility methods for RESTBase
 */

var util = {};
var url = require('url');
var Busboy = require('busboy');
var uuid = require('node-uuid');
var bunyan = require('bunyan');
var gelf_stream = require('gelf-stream');
var dgram = require( 'dgram' );

// TODO: use bunyan or the Parsoid logger backend!
util.log = function (level, e) {
    var msg = '[' + level + ']';
    if (e) {
        msg += ': ';
        if (e.stack) {
            msg += e.stack;
        } else {
            msg += e;
        }
    }
    if (/^error/.test(level)) {
        console.error(msg);
    } else {
        console.log(msg);
    }
};

// Timer that can report to StatsD
util.Timer = function ( statsdHost ) {
    var host, port, timers = {};
    statsdHost = /([A-Z0-9.]+):(\d+)/i.exec( statsdHost );
    if ( statsdHost ) {
        host = statsdHost[1];
        port = Number( statsdHost[2] );
    }

    function send( name, mtype, ms ) {
        name = name.replace( /[\W_]+/g, '.' );
        var buf = new Buffer( 'restbase.backend.' + name  + ':' + Math.round( ms ) + '|' + mtype ),
        sock = dgram.createSocket( 'udp4' );
        sock.send( buf, 0, buf.length, port, host, sock.close.bind( sock ) );
    }

    this.start = function ( name ) {
        timers[name] = process.hrtime();
    };

    this.stop = function ( name ) {
        var delta = process.hrtime([timers[name]]),
        ms = ( delta[0] * 1000 ) + ( delta[1] * 0.000001 );
        if ( port ) {
            name = name + ".time";
            send( name, 'ms', ms );
        }
       return ms;
    };

    this.count = function ( name ) {
        if ( port ) {
            name = name + ".error";
            send( name, 'c' );
        }
    };
};

// Optimized URL parsing
var qs = require('querystring');
// Should make it into 0.12, see https://github.com/joyent/node/pull/7878
var SIMPLE_PATH = /^(\/(?!\/)[^\?#\s]*)(\?[^#\s]*)?$/;
util.parseURL = function parseURL (uri) {
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
util.parsePOST = function parsePOST(req) {
    if (req.method === 'PUT') {
        return new Promise(function(resolve) {
            var chunks = [];
            req.on('data', function(chunk) {
                chunks.push(chunk);
            });

            req.on('end', function() {
                req.body = Buffer.concat(chunks);
                resolve();
            });
        });
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

util.reverseDomain = function reverseDomain (domain) {
    return domain.toLowerCase().split('.').reverse().join('.');
};

util.tidFromDate = function tidFromDate(date) {
    // Create a new, deterministic timestamp
    return uuid.v1({
        node: [0x01, 0x23, 0x45, 0x67, 0x89, 0xab],
        clockseq: 0x1234,
        msecs: date.getTime(),
        nsecs: 0
    });
};

util.extend = require('extend');


// Simple bunyan logger wrapper
function Logger (conf, logger) {
    this.logger = logger || bunyan.createLogger(conf);
}

Logger.prototype.log = function (level) {
    var logger = this.logger;
    var simpleLevel = level.replace(/([^\/]+)(\/.*)?$/, '$1');
    var params = Array.prototype.slice.call(arguments, 1);
    if (logger[simpleLevel]) {
        logger[simpleLevel].apply(logger, params);
    } else {
        logger.info.apply(logger, params);
    }
};

util.makeLogger = function(conf) {
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
        conf = util.extend({}, conf);
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
    return bindAndChild(newLogger);
};

module.exports = util;
