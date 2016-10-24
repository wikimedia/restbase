"use strict";

const uuid = require('cassandra-uuid').TimeUuid;
const contentType = require('content-type');
const jwt = require('jsonwebtoken');
const P = require('bluebird');
const entities = require('entities');
const gunzip = P.promisify(require('zlib').gunzip);
const Title = require('mediawiki-title').Title;
const HyperSwitch = require('hyperswitch');
const querystring = require('querystring');
const HTTPError = HyperSwitch.HTTPError;
const URI = HyperSwitch.URI;
const mwUtil = {};

/**
 * Create an etag value of the form
 * "<revision>/<tid>/<optional_suffix>"
 * @param {Integer} rev page revision number
 * @param {string} tid page render UUID
 * @param {string} [suffix] optional suffix
 * @returns {string} the value of the ETag header
 */
mwUtil.makeETag = (rev, tid, suffix) => {
    let etag = `"${rev}/${tid}`;
    if (suffix) {
        etag += `/${suffix}`;
    }
    return `${etag}"`;
};

/**
 * Normalizes the request.params.title and returns it back
 */
mwUtil.normalizeTitle = (hyper, req, title) => mwUtil.getSiteInfo(hyper, req)
.then((siteInfo) => Title.newFromText(title, siteInfo))
.catch((e) => {
    throw new HTTPError({
        status: 400,
        body: {
            type: 'bad_request',
            detail: e.message
        }
    });
});

/**
 * Parse an etag value of the form
 * "<revision>/<tid>/<suffix>"
 * @param {string} etag
 * @returns {Object} an object with rev, tid and optional suffix properties
 */
mwUtil.parseETag = (etag) => {
    const bits = /^"?([^"\/]+)(?:\/([^"\/]+))(?:\/([^"]+))?"?$/.exec(etag);
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
mwUtil.extractDateFromEtag = (etag) => {
    const bits = mwUtil.parseETag(etag);
    if (bits) {
        return uuid.fromString(bits.tid).getDate();
    } else {
        return null;
    }
};

mwUtil.coerceTid = (tidString, bucket) => {
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
            bucket
        }
    });
};

/**
 * Normalizes the order of 'Content-Type' header fields.
 *
 * @param res server response
 */
mwUtil.normalizeContentType = (res) => {
    if (res && res.headers && res.headers['content-type']) {
        const cType = res.headers['content-type'];
        if (/^text\/html\b/.test(cType) && !/charset=/.test(cType)) {
            // Make sure a charset is set
            res.headers['content-type'] = `${cType};charset=utf-8`;
        }
        res.headers['content-type'] = contentType.format(contentType.parse(cType));
    }
};

/**
 * Checks whether the request is a 'no-cache' request
 *
 * @param {Object} req
 */
mwUtil.isNoCacheRequest = (req) => req.headers && /no-cache/i.test(req.headers['cache-control']);

mwUtil.parseRevision = (rev, bucketName) => {
    if (!/^[0-9]+/.test(rev)) {
        throw new HTTPError({
            status: 400,
            body: {
                type: 'bad_request#invalid_revision',
                title: 'Invalid revision parameter',
                rev,
                bucket: bucketName
            }
        });
    }

    return parseInt(rev);
};

mwUtil.getLimit = (hyper, req) => {
    if (req.body && req.body.limit) {
        return req.body.limit;
    } else if (req.query && req.query.limit) {
        return req.query.limit;
    }
    return hyper.config.default_page_size;
};

/**
 * Applies access checks to the item. Throws appropriate HTTPError
 * if access is restricted, no-op otherwise.
 *
 * Item might be either a revision or a restriction.
 *
 * @param {Object} item the item to check restriction on
 * @param {Number} [targetRev] the item revision.
 *                             Used in case item is a restriction to
 *                             indicate the content revision num.
 */
mwUtil.applyAccessChecks = (restrictions, targetRev) => {
    // Page was deleted - new version of tracking
    if (restrictions.page_deleted) {
        if (!targetRev || restrictions.rev <= restrictions.page_deleted) {
            throw new HTTPError({
                status: 404,
                body: {
                    type: 'not_found#page_revisions',
                    description: 'Page was deleted'
                }
            });
        }
    }

    if (restrictions && Array.isArray(restrictions.restrictions)
            && restrictions.restrictions.length > 0) {
        // Page was deleted - old version of tracking
        if (restrictions.restrictions.indexOf('page_deleted') >= 0) {
            throw new HTTPError({
                status: 404,
                body: {
                    type: 'not_found#page_revisions',
                    description: 'Page was deleted'
                }
            });
        }
        // Revision restricted
        if (restrictions.restrictions.indexOf('sha1hidden') >= 0
            || restrictions.restrictions.indexOf('texthidden') >= 0) {
            throw new HTTPError({
                status: 403,
                body: {
                    type: 'access_denied#revision',
                    title: 'Access to resource denied',
                    description: `Access is restricted for revision ${restrictions.rev}`,
                    restrictions: restrictions.restrictions
                }
            });
        }
    }
};

/**
 * Create a json web token.
 *
 * @param {HyperSwitch} hyper HyperSwitch context*
 * @param {Object} object a JSON object to encode
 * @returns {string}
 */
mwUtil.encodePagingToken = (hyper, object) => {
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
mwUtil.decodePagingToken = (hyper, token) => {
    if (typeof hyper.config.salt !== 'string') {
        throw new Error('Invalid salt config parameter. Must be a string');
    }

    try {
        const next = jwt.verify(token, hyper.config.salt);
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

mwUtil.decodeBody = (contentResponse) => {
    let prepare;
    if (contentResponse.headers
            && contentResponse.headers['content-encoding'] === 'gzip') {
        delete contentResponse.headers['content-encoding'];
        prepare = gunzip(contentResponse.body);
    } else {
        prepare = P.resolve(contentResponse.body);
    }
    return prepare.then((body) => {
        if (body && Buffer.isBuffer(body)) {
            body = body.toString();
        }
        contentResponse.body = body;
        return contentResponse;
    });
};

function findSharedRepoDomain(siteInfoRes) {
    const sharedRepo = (siteInfoRes.body.query.repos || []).find((repo) => repo.name === 'shared');
    if (sharedRepo) {
        const domainMatch = /^((:?https?:)?\/\/[^/]+)/.exec(sharedRepo.descBaseUrl);
        if (domainMatch) {
            return domainMatch[0];
        }
    }
}

const siteInfoCache = {};
mwUtil.getSiteInfo = (hyper, req) => {
    const rp = req.params;
    if (!siteInfoCache[rp.domain]) {
        siteInfoCache[rp.domain] = hyper.post({
            uri: new URI([rp.domain, 'sys', 'action', 'siteinfo']),
            body: {
                siprop: 'general|namespaces|namespacealiases'
            }
        })
        .then((res) => {
            if (!res || !res.body || !res.body.query || !res.body.query.general) {
                throw new Error(`SiteInfo is unavailable for ${rp.domain}`);
            }
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
        .catch((e) => {
            hyper.log('error/site_info', e);
            delete siteInfoCache[rp.domain];
            throw e;
        });
    }
    return siteInfoCache[rp.domain];
};

mwUtil.getQueryString = (req) => {
    if (Object.keys(req.query).length) {
        return `?${querystring.stringify(req.query)}`;
    }
    return '';
};

mwUtil.addQueryString = (location, query) => {
    if (location.indexOf('?') !== -1) {
        return `${location}&${querystring.stringify(query)}`;
    } else {
        return `${location}?${querystring.stringify(query)}`;
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
mwUtil.createRelativeTitleRedirect = (path, req, options) => {
    options = options || {};
    const titleParamName = options.titleParamName || 'title';
    const newReqParams = options.newReqParams || req.params;
    let pathBeforeTitle = path.substring(0, path.indexOf(`{${titleParamName}}`));
    pathBeforeTitle = new URI(pathBeforeTitle, req.params, true).toString();
    // Omit the domain prefix as it could be wrong for node shared between domains
    pathBeforeTitle = pathBeforeTitle.replace(/^\/[^\/]+\//, '');
    const pathSuffix = req.uri.toString()
            .replace(/^\/[^\/]+\//, '')
            .replace(pathBeforeTitle, '');
    const pathSuffixCount = (pathSuffix.match(/\//g) || []).length;
    const backString = Array.apply(null, { length: pathSuffixCount }).map(() => '../').join('');
    if (!options.dropPathAfterTitle) {
        const pathPatternAfterTitle = path.substring(path.indexOf('{title}') - 1);
        return backString
            + new URI(pathPatternAfterTitle, newReqParams, true).toString().substr(1)
            + mwUtil.getQueryString(req);
    } else {
        return backString + encodeURIComponent(newReqParams.title) + mwUtil.getQueryString(req);
    }
};

const redirectRegEx = /<link rel="mw:PageProp\/redirect" href="\.\/([^"#]+)(?:#[^"]*)?"/;
mwUtil.extractRedirect = (html) => {
    const redirectMatch = redirectRegEx.exec(html);
    if (redirectMatch) {
        return decodeURIComponent(entities.decodeXML(redirectMatch[1]));
    } else {
        return null;
    }
};

mwUtil.isSelfRedirect = (req, location) => {
    let indexInPath = req.uri.path.length - 1;
    let query;

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

    const locationPath = location.split('/');
    for (let i = 0; i < locationPath.length; i++) {
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
