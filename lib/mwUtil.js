"use strict";

var uuid = require('cassandra-uuid').TimeUuid;
var contentType = require('content-type');
var jwt = require('jsonwebtoken');
var P = require('bluebird');
var gunzip = P.promisify(require('zlib').gunzip);
var Title = require('mediawiki-title').Title;
var HyperSwitch = require('hyperswitch');
var querystring = require('querystring');
var HTTPError = HyperSwitch.HTTPError;
var URI = HyperSwitch.URI;
var mwUtil = {};

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
 * Normalizes the request.params.title and returns it back
 */
mwUtil.normalizeTitle = function(hyper, req, title) {
    return mwUtil.getSiteInfo(hyper, req)
    .then(function(siteInfo) {
        return Title.newFromText(title, siteInfo);
    })
    .catch(function(e) {
        throw new HTTPError({
            status: 400,
            body: {
                type: 'bad_request',
                detail: e.message
            }
        });
    });
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
 * Extract the date from an `etag` header of the form
 * "<revision>/<tid>/<suffix>"
 * @param {string} etag
 * @returns {Date|null}
 */
mwUtil.extractDateFromEtag = function(etag) {
    var bits = mwUtil.parseETag(etag);
    if (bits) {
        return uuid.fromString(bits.tid).getDate();
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
            type: 'bad_request#invalid_tid',
            title: 'Invalid tid parameter',
            tid: tidString,
            bucket: bucket
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
        var cType = res.headers['content-type'];
        if (/^text\/html\b/.test(cType) && !/charset=/.test(cType)) {
            // Make sure a charset is set
            res.headers['content-type'] = cType + ';charset=utf-8';
        }
        res.headers['content-type'] = contentType.format(contentType.parse(cType));
    }
};

/**
 * Checks whether the request is a 'no-cache' request
 *
 * @param {Object} req
 */
mwUtil.isNoCacheRequest = function(req) {
    return req.headers && /no-cache/i.test(req.headers['cache-control']);
};

mwUtil.parseRevision = function(rev, bucketName) {
    if (!/^[0-9]+/.test(rev)) {
        throw new HTTPError({
            status: 400,
            body: {
                type: 'bad_request#invalid_revision',
                title: 'Invalid revision parameter',
                rev: rev,
                bucket: bucketName
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
                type: 'bad_request#invalid_paging_token',
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

function findSharedRepoDomain(siteInfoRes) {
    var sharedRepo = (siteInfoRes.body.query.repos || []).find(function(repo) {
        return repo.name === 'shared';
    });
    if (sharedRepo) {
        var domainMatch = /^((:?https?:)?\/\/[^/]+)/.exec(sharedRepo.descBaseUrl);
        if (domainMatch) {
            return domainMatch[0];
        }
    }
}

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
                general: {
                    lang: res.body.query.general.lang,
                    legaltitlechars: res.body.query.general.legaltitlechars,
                    case: res.body.query.general.case
                },
                namespaces: res.body.query.namespaces,
                namespacealiases: res.body.query.namespacealiases,
                sharedRepoRootURI: findSharedRepoDomain(res)
            };
        })
        .catch(function(e) {
            hyper.log('error/site_info', e);
            delete siteInfoCache[rp.domain];
            throw e;
        });
    }
    return siteInfoCache[rp.domain];
};

mwUtil.getQueryString = function(req) {
    if (Object.keys(req.query).length) {
        return '?' + querystring.stringify(req.query);
    }
    return '';
};

mwUtil.addQueryString = function(location, query) {
    if (location.indexOf('?') !== -1) {
        return location + '&' + querystring.stringify(query);
    } else {
        return location + '?' + querystring.stringify(query);
    }
};

/**
 * Create a `location` header value for a relative redirect.
 *
 * @param {string} path, the path pattern from specInfo.
 * @param {hyper.request} req, the request
 * @param {object} options, with possible parameters:
 * @param {object} options.newReqParams, use these parameters instead of the
 * original request parameters.
 * @param {string} options.titleParamName, the name of the title parameter.
 * @param {boolean} options.dropPathAfterTitle, indicating that the redirect should drop
 *    the path after the title parameter. Typically used for redirects to
 *    another title, where revision & tid would no longer match.
 * @return {string} Location header value containing a relative redirect path.
 */
mwUtil.createRelativeTitleRedirect = function(path, req, options) {
    options = options || {};
    var titleParamName = options.titleParamName || 'title';
    var newReqParams = options.newReqParams || req.params;
    var pathBeforeTitle = path.substring(0, path.indexOf('{' + titleParamName + '}'));
    pathBeforeTitle = new URI(pathBeforeTitle, req.params, true).toString();
    // Omit the domain prefix as it could be wrong for node shared between domains
    pathBeforeTitle = pathBeforeTitle.replace(/^\/[^\/]+\//, '');
    var pathSuffix = req.uri.toString()
            .replace(/^\/[^\/]+\//, '')
            .replace(pathBeforeTitle, '');
    var pathSuffixCount = (pathSuffix.match(/\//g) || []).length;
    var backString = Array.apply(null, { length: pathSuffixCount }).map(function() {
        return '../';
    }).join('');
    if (!options.dropPathAfterTitle) {
        var pathPatternAfterTitle = path.substring(path.indexOf('{title}') - 1);
        return backString
            + new URI(pathPatternAfterTitle, newReqParams, true).toString().substr(1)
            + mwUtil.getQueryString(req);
    } else {
        return backString + encodeURIComponent(newReqParams.title) + mwUtil.getQueryString(req);
    }
};

mwUtil.isSelfRedirect = function(req, location) {
    var indexInPath = req.uri.path.length - 1;
    var query;

    if (location.indexOf('?') !== -1) {
        query = location.substring(location.indexOf('?'));
        location = location.substring(0, location.indexOf('?'));
    } else {
        query = '';
    }

    if (mwUtil.getQueryString(req) !== query) {
        // If the query is different - redirect even if the location is the same
        return false;
    }

    var locationPath = location.split('/');
    for (var i = 0; i < locationPath.length; i++) {
        if (locationPath[i] === '..') {
            indexInPath -= 1;
        } else if (decodeURIComponent(locationPath[i]) !== req.uri.path[indexInPath]) {
            return false;
        } else {
            indexInPath += 1;
        }
    }
    return true;
};

module.exports = mwUtil;
