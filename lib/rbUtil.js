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

function isHtmlSvgContent(res) {
    return res.headers
        && /^(?:text\/html|image\/svg)/i.test(res.headers['content-type']);
}

var cspHeaderVariants = [
    'content-security-policy',
    // For IE 10 & 11
    'x-content-security-policy',
    // For Chrome <= v25 (<<1% traffic; todo: revisit support)
    'x-webkit-csp',
];

/**
 * Adds Content-Security-Policy & related headers to send in response
 *
 * @param res response object
 * @param options options containing the following fields:
 *                - domain: the domain to allow. If undefined, '*' is allowed
 *                - allowInline: if true 'unsafe-inline' is added to style-src
 */
rbUtil.addCSPHeaders = function(res, options) {
    if (!res.headers) {
        res.headers = {};
    }
    var rh = res.headers;
    var csp;
    if (isHtmlSvgContent(res)) {
        // Let backend services override CSP headers for HTML / SVG
        // XXX: Re-consider this policy
        if (rh['content-security-policy']) {
            csp = rh['content-security-policy'];
        } else {
            // Our main production clients will ignore CSP anyway (by loading via
            // XHR or fetch), so we need to sanitize our HTML assuming that no
            // CSP is enforced on the client. This means that we might actually
            // gain some security by convincing some users to load HTML in frames,
            // and thus actually enforce CSP. It is also useful to preview content
            // in the browser.
            var styleSource;
            if (options.domain) {
                styleSource = this.wildcardSubdomain(options.domain);
                styleSource = 'http://' + styleSource + ' https://' + styleSource;
            } else {
                styleSource = '*';
            }
            csp = "default-src 'none'; media-src *; img-src *; style-src "
                + styleSource
                + (options && options.allowInline ? " 'unsafe-inline'" : "")
                + "; frame-ancestors 'self'";
        }
    } else {
        // Other content: Disallow everything, especially framing to avoid
        // re-dressing attacks.
        csp = "default-src 'none'; frame-ancestors 'none'";
    }
    rh['x-xss-protection'] = '1; mode=block';

    // Finally, assign the csp header variants
    cspHeaderVariants.forEach(function(name) {
        rh[name] = csp;
    });
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

/**
 * Create a uniform but shallow request object copy with sane defaults. This
 * keeps code dealing with this request monomorphic (good for perf), and
 * avoids subtle bugs when requests shared between recursive requests are
 * mutated in another control branch. At the very minimum, we are mutating the
 *
 * @param req original request object
 * @returns a shallow copy of a provided requests
 */
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
 *
 * @param restbase a restbase instance to take the forwarded headers from
 * @param req a request where to copy the headers
 * @param headers array of header names to copy
 */
rbUtil.copyForwardedHeaders = function(restbase, req, headers) {
    if (restbase._rootReq && restbase._forwardedHeaders) {
        req.headers = req.headers || {};
        headers.filter(function(header) {
            return !req.headers[header] && restbase._forwardedHeaders[header];
        }).forEach(function(header) {
            req.headers[header] = restbase._forwardedHeaders[header];
        });
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
