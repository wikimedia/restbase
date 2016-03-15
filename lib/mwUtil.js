"use strict";

var uuid = require('cassandra-uuid').TimeUuid;
var contentType = require('content-type');
var jwt = require('jsonwebtoken');
var P = require('bluebird');
var gunzip = P.promisify(require('zlib').gunzip);
var HyperSwitch = require('hyperswitch');
var HTTPError = HyperSwitch.HTTPError;
var URI = HyperSwitch.URI;

var mwUtil = {};

/**
 * Store titles as MediaWiki db keys
 * @param {string} title a title to normalize
 * @returns {string} normalized title
 */
mwUtil.normalizeTitle = function(title) {
    return title.replace(/ /g, '_');
};

/**
 * Create an etag value of the form
 * "<revision>/<tid>/<optional_suffix>"
 * @param {Integer} rev page revision number
 * @param {string} tid page render UUID
 * @param {string} [suffix] optional suffix
 * @returns {string} the value of the ETag header
 */
mwUtil.makeETag = function(rev, tid, suffix) {
    var etag = '"' + rev + '/' + tid;
    if (suffix) {
        etag += '/' + suffix;
    }
    return etag + '"';
};

/**
 * Parse an etag value of the form
 * "<revision>/<tid>/<suffix>"
 * @param {string} etag
 * @returns {Object} an object with rev, tid and optional suffix properties
 */
mwUtil.parseETag = function(etag) {
    var bits = /^"?([^"\/]+)(?:\/([^"\/]+))(?:\/([^"]+))?"?$/.exec(etag);
    if (bits) {
        return {
            rev: bits[1],
            tid: bits[2],
            suffix: bits[3]
        };
    } else {
        return null;
    }
};

mwUtil.coerceTid = function(tidString, bucket) {
    if (uuid.test(tidString)) {
        return tidString;
    }

    // Out of luck
    throw new HTTPError({
        status: 400,
        body: {
            type: (bucket || 'bucket') + '/invalid_tid',
            title: 'Invalid tid parameter',
            tid: tidString
        }
    });
};

/**
 * Normalizes the order of 'Content-Type' header fields.
 *
 * @param res server response
 */
mwUtil.normalizeContentType = function(res) {
    if (res && res.headers && res.headers['content-type']) {
        res.headers['content-type'] =
        contentType.format(contentType.parse(res.headers['content-type']));
    }
};

mwUtil.parseRevision = function(rev, bucketName) {
    if (!/^[0-9]+/.test(rev)) {
        throw new HTTPError({
            status: 400,
            body: {
                type: bucketName + '/invalid_revision',
                title: 'Invalid revision parameter',
                rev: rev
            }
        });
    }

    return parseInt(rev);
};

mwUtil.getLimit = function(hyper, req) {
    if (req.body && req.body.limit) {
        return req.body.limit;
    } else if (req.query && req.query.limit) {
        return req.query.limit;
    }
    return hyper.config.default_page_size;
};

/**
 * Create a json web token.
 *
 * @param {HyperSwitch} hyper HyperSwitch context*
 * @param {Object} object a JSON object to encode
 * @returns {string}
 */
mwUtil.encodePagingToken = function(hyper, object) {
    if (typeof hyper.config.salt !== 'string') {
        throw new Error('Invalid salt config parameter. Must be a string');
    }

    return jwt.sign({ next: object }, hyper.config.salt);
};

/**
 * Decode signed token and decode the orignal token
 *
 * @param {HyperSwitch} hyper HyperSwitch context
 * @param {string} token paging request token
 * @returns {Object}
 */
mwUtil.decodePagingToken = function(hyper, token) {
    if (typeof hyper.config.salt !== 'string') {
        throw new Error('Invalid salt config parameter. Must be a string');
    }

    try {
        var next = jwt.verify(token, hyper.config.salt);
        return next.next;
    } catch (e) {
        throw new HTTPError({
            status: 400,
            body: {
                type: 'invalid_paging_token',
                title: 'Invalid paging token'
            }
        });
    }
};

mwUtil.decodeBody = function(contentResponse) {
    var prepare;
    if (contentResponse.headers
            && contentResponse.headers['content-encoding'] === 'gzip') {
        delete contentResponse.headers['content-encoding'];
        prepare = gunzip(contentResponse.body);
    } else {
        prepare = P.resolve(contentResponse.body);
    }
    return prepare.then(function(body) {
        if (body && Buffer.isBuffer(body)) {
            body = body.toString();
        }
        contentResponse.body = body;
        return contentResponse;
    });
};

var siteInfoCache = {};
mwUtil.getSiteInfo = function(hyper, req) {
    var rp = req.params;
    if (!siteInfoCache[rp.domain]) {
        siteInfoCache[rp.domain] = hyper.post({
            uri: new URI([rp.domain, 'sys', 'action', 'siteinfo']),
            body: {
                siprop: 'general|namespaces|namespacealiases'
            }
        })
        .then(function(res) {
            return {
                lang: res.body.query.general.lang,
                legaltitlechars: res.body.query.general.legaltitlechars,
                namespaces: res.body.query.namespaces,
                namespacealiases: res.body.query.namespacealiases
            };
        });
    }
    return siteInfoCache[rp.domain];
};

module.exports = mwUtil;