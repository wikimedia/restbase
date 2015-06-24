"use strict";


/*
 * Static utility methods for RESTBase
 */

var P = require('bluebird');
var util = require('util');
var url = require('url');
var Busboy = require('busboy');
var uuid = require('cassandra-uuid').TimeUuid;

var rbUtil = {};

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
    return new P(function (resolve) {
        var chunks = [];
        req.on('data', function(chunk) {
            chunks.push(chunk);
        });

        req.on('end', function() {
            resolve(Buffer.concat(chunks));
        });
    });
}

rbUtil.parsePOST = function parsePOST(req) {

    var readIt =
        (req.method === 'PUT') ||
        (req.method === 'POST' && req.headers &&
         (/^application\/json/i.test(req.headers['content-type'])
            || !req.headers['content-type']));

    if (readIt) {
        return read(req);
    } else if (req.method !== 'POST') {
        return P.resolve();
    } else {
        // Parse the POST
        return new P(function(resolve) {
            // Parse POST data
            var bboy = new Busboy({
                headers: req.headers,
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
    return uuid.fromDate(date,
        0,
        new Buffer([0x01, 0x23, 0x45, 0x67, 0x89, 0xab]),
        new Buffer([0x12, 0x34])).toString();
};

/**
 * Check if a string is a valid timeuuid
 */
rbUtil.isTimeUUID = function (s) {
    return uuid.test(s);
};

/**
 * Generates a new request ID
 */
rbUtil.generateRequestId = function() {
    return uuid.now().toString();
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


// Create an etag value of the form
// "<revision>/<tid>"
rbUtil.makeETag = function(rev, tid) {
    return '"' + rev + '/' + tid + '"';
};

// Parse an etag value of the form
// "<revision>/<tid>"
// @param {string} etag
// @return {object} with params rev / tid
rbUtil.parseETag = function(etag) {
    var bits = /^"?([^"\/]+)(?:\/([^"\/]+))"?$/.exec(etag);
    if (bits) {
        return {
            rev: bits[1],
            tid: bits[2],
        };
    } else {
        return null;
    }
};


/***
 * MediaWiki-specific functions
 * TODO: Move them out in a separate file
 ***/

// Store titles as MediaWiki db keys
// @param {string} title
// @return {string} normalised title
rbUtil.normalizeTitle = function(title) {
    return title.replace(/ /g, '_');
};


module.exports = rbUtil;
