"use strict";

var uuid = require('cassandra-uuid').TimeUuid;
var contentType = require('content-type');

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

/**
 * Creates a deterministic version 1 UUID from a given date
 * @param {Date|string|Number} date a Date
 * @returns {string} a deterministic v1 UUID
 */
mwUtil.tidFromDate = function(date) {
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
    return uuid.min(date,
    0,
    new Buffer([0x01, 0x23, 0x45, 0x67, 0x89, 0xab]),
    new Buffer([0x12, 0x34])).toString();
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


module.exports = mwUtil;