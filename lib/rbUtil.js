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
rbUtil.parseURL = function parseURL(uri) {
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

/**
 * Replaces subdomain with a wildcard
 *
 * @param domain a full domain name (e.g. en.wikipedia.org)
 * @returns {string} wildcard version (e.g. *.wikipedia.org)
 */
rbUtil.wildcardSubdomain = function(domain) {
    if ((domain.match(/\./g) || []).length >= 2) {
        return '*.' + domain.replace(/^[^.]+\./, "");
    } else {
        return domain;
    }
};

/**
 * Constructs Content-Security-Policy header to send in response
 *
 * @param domain the domain to allow. If undefined, '*' is allowed
 * @param options options containing the following fields:
 *                - allowInline - if true 'unsafe-inline' is added to style-src
 * @returns {string} CSP header value
 */
rbUtil.constructCSP = function(domain, options) {
    var styleSource;
    if (domain) {
        styleSource = this.wildcardSubdomain(domain);
        styleSource = 'http://' + styleSource + ' https://' + styleSource;
    } else {
        styleSource = '*';
    }
    return "default-src 'none'; media-src *; img-src *; style-src " + styleSource
        + (options && options.allowInline ? " 'unsafe-inline'" : "") + "; frame-ancestors 'self'";
};

// Parse a POST request into request.body with BusBoy
// Drops file uploads on the floor without creating temporary files
//
// @param {request} HTTP request
// @returns {Promise<>}

function read(req) {
    return new P(function(resolve) {
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
            bboy.on('field', function(field, val) {
                body[field] = val;
            });
            bboy.on('finish', function() {
                resolve(body);
            });
            req.pipe(bboy);
        });
    }
};

rbUtil.reverseDomain = function reverseDomain(domain) {
    return domain.toLowerCase().split('.').reverse().join('.');
};

rbUtil.tidFromDate = function tidFromDate(date) {
    if (typeof date === 'object') {
        // Convert Date object to numeric milliseconds
        date = date.getTime();
    } else if (typeof date === 'string') {
        // Convert date string to numeric milliseconds
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
rbUtil.isTimeUUID = function(s) {
    return uuid.test(s);
};

/**
 * Generates a new request ID
 */
rbUtil.generateRequestId = function() {
    return uuid.now().toString();
};

// Create a uniform but shallow request object copy with sane defaults. This
// keeps code dealing with this request monomorphic (good for perf), and
// avoids subtle bugs when requests shared between recursive requests are
// mutated in another control branch. At the very minimum, we are mutating the
// .params property for each sub-request.
rbUtil.cloneRequest = function(req) {
    return {
        uri: req.uri || req.url || null,
        method: req.method || 'get',
        headers: req.headers || {},
        query: req.query || {},
        body: req.body || null,
        params: req.params || {}
    };
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
            tid: bits[2]
        };
    } else {
        return null;
    }
};

/**
 * Copies forwarded headers from restbase to request.
 * If the same header was already set it takes precedence over
 * the forwarded header.
 */
rbUtil.copyForwardedCookies = function(restbase, req) {
    if (restbase._rootReq
            && restbase._forwardedCookies
            && !req.headers.cookie) {
        req.headers = req.headers || {};
        req.headers.cookie = restbase._forwardedCookies;
    }
    return req;
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
