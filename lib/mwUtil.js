"use strict";

var uuid = require('cassandra-uuid').TimeUuid;
var contentType = require('content-type');
var HTTPError = require('hyperswitch').HTTPError;

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
 * @param {string} suffix optional suffix
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


module.exports = mwUtil;