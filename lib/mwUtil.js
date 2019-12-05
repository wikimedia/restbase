'use strict';

const uuidUtils = require('./uuidUtils');
const contentType = require('content-type');
const jwt = require('jsonwebtoken');
const P = require('bluebird');
const entities = require('entities');
const Title = require('mediawiki-title').Title;
const HyperSwitch = require('hyperswitch');
const querystring = require('querystring');
const cType = require('content-type');
const HTTPError = HyperSwitch.HTTPError;
const URI = HyperSwitch.URI;
const mwUtil = {};

/**
 * Create an etag value of the form
 * "<revision>/<tid>/<optional_suffix>"
 * @param   {Integer}   rev         page revision number
 * @param   {string}    tid         page render UUID
 * @param   {string}    [suffix]    optional suffix
 * @return  {string}                the value of the ETag header
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
 * @param   {HyperSwitch} hyper   hyperswitch
 * @param   {Object}      req     request object
 * @param   {string}      title
 * @return  {Object}             normalzied title
 */
mwUtil.normalizeTitle = (hyper, req, title) =>  mwUtil.getSiteInfo(hyper, req)
.then((siteInfo) => {
    try {
        return Title.newFromText(title, siteInfo);
    } catch (e) {
        throw new HTTPError({
            status: 400,
            body: {
                type: 'bad_request',
                detail: e.message
            }
        });
    }
});

/**
 * Parse an etag value of the form
 * "<revision>/<tid>/<suffix>"
 * @param   {string} etag   tag to parse
 * @return  {Object}        an object with rev, tid and optional suffix properties
 */
mwUtil.parseETag = (etag) => {
    const bits = /^(?:W\/)?"?([^"/]+)(?:\/([^"/]+))(?:\/([^"]+))?"?$/.exec(etag);
    if (!bits) {
        return null;
    }
    const ret = {
        rev: bits[1],
        tid: bits[2],
        suffix: bits[3]
    };
    // T230272: the TID itself may be suffixed (this is allowed by
    // RfC7232), so extract only the proper TID
    if (ret.tid && ret.tid.length > 36) {
        const tidBits = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})-?(.*)$/i.exec(ret.tid);
        if (tidBits) {
            ret.tid = tidBits[1];
            ret.tidSuffix = tidBits[2];
        } else {
            // this is not a valid UUIDv1, but ignore this case for now
            // and let the TID through unmodified
        }
    }
    return ret;
};

/**
 * Checks whether a language variant could exist for
 * a page in a requested language on a particular wiki.
 * @param   {HyperSwitch}       hyper
 * @param   {Object}            req
 * @param   {string}            pageLanguage the language of the requested page.
 * @return  {Promise<boolean>}
 */
mwUtil.canConvertLangVariant = (hyper, req, pageLanguage) => {
    return mwUtil.getSiteInfo(hyper, req)
    .then((siteInfo) => !!siteInfo.languagevariants[pageLanguage.toLowerCase()]);
};

/**
 * Checks whether a specialized requested language variant exist for
 * a page in a requested language on a particular wiki.
 * @param {HyperSwitch}     hyper
 * @param {Object}          req
 * @param {string}          pageLang    the language of the requested page.
 * @param {string}          acceptLang  the language variant accepted by the client.
 * @return {Promise<boolean>}
 */
mwUtil.shouldConvertLangVariant = (hyper, req, pageLang, acceptLang) => {
    if (!acceptLang) {
        return P.resolve(false);
    }
    return mwUtil.getSiteInfo(hyper, req)
    .then((siteInfo) => {
        const pageLangWithFallback = pageLang ? pageLang.toLowerCase() : siteInfo.general.lang;
        // First, whether specialized variants exist for the page lang on a wiki
        const pageLangVariants = siteInfo.languagevariants[pageLangWithFallback];
        if (!pageLangVariants) {
            return false;
        }
        // Second, if the requested language variant exist for page language
        return pageLangVariants.indexOf(acceptLang.toLowerCase()) !== -1;
    });
};

/**
 * Extract the date from an `etag` header of the form
 * "<revision>/<tid>/<suffix>"
 * @param   {string}    etag
 * @return  {Date|null}
 */
mwUtil.extractDateFromEtag = (etag) => {
    const bits = mwUtil.parseETag(etag);
    if (bits) {
        return uuidUtils.getDate(bits.tid);
    } else {
        return null;
    }
};

mwUtil.coerceTid = (tidString, bucket) => {
    if (uuidUtils.test(tidString)) {
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
 * @param {Object} res server response
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
 * @param   {Object}    req
 * @return  {boolean}
 */
mwUtil.isNoCacheRequest = (req) => req.headers && /no-cache/i.test(req.headers['cache-control']);

/**
 * Checks whether the request is a 'no-store' request
 * @param   {Object}    req
 * @return  {boolean}
 */
mwUtil.isNoStoreRequest = (req) => req.headers && /no-store/i.test(req.headers['cache-control']);

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

    return parseInt(rev, 10);
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
 * @param {Object} revision the revision object
 */
mwUtil.applyAccessChecks = (revision) => {
    // Page was deleted - new version of tracking
    if (revision.page_deleted) {
        throw new HTTPError({
            status: 404,
            body: {
                type: 'not_found#page_revisions',
                description: 'Page was deleted'
            }
        });
    }

    if (revision && Array.isArray(revision.restrictions) &&
            revision.restrictions.length > 0) {
        // Revision restricted
        if (revision.restrictions.indexOf('sha1hidden') >= 0 ||
            revision.restrictions.indexOf('texthidden') >= 0) {
            throw new HTTPError({
                status: 403,
                body: {
                    type: 'access_denied#revision',
                    title: 'Access to resource denied',
                    description: `Access is restricted for revision ${revision.rev}`,
                    restrictions: revision.restrictions
                }
            });
        }
    }
};

/**
 * Create a json web token.
 * @param   {HyperSwitch}   hyper   HyperSwitch context*
 * @param   {Object}        object  a JSON object to encode
 * @return  {string}
 */
mwUtil.encodePagingToken = (hyper, object) => {
    if (typeof hyper.config.salt !== 'string') {
        throw new Error('Invalid salt config parameter. Must be a string');
    }

    return jwt.sign({ next: object }, hyper.config.salt);
};

/**
 * Decode signed token and decode the orignal token
 * @param   {HyperSwitch}   hyper HyperSwitch context
 * @param   {string}        token paging request token
 * @return  {Object}
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

/**
 *
 * @param   {!HyperSwitch}  hyper       HyperSwitch context
 * @param   {!Object}       req         request object
 * @param   {string}        [domain]    (optional) Wiki domain to get siteinfo from
 *                                      (defaults to the request domain).
 * @return  {URI}                       siteinfo URI
 */
mwUtil.getSiteInfo = (hyper, req, domain) => hyper.get({
    uri: new URI([domain || req.params.domain, 'sys', 'action', 'siteinfo'])
}).get('body');

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
 * @param   {string}        path                        the path pattern from specInfo.
 * @param   {hyper.request} req                         the request
 * @param   {Object}        options                     with possible parameters:
 * @param   {Object}        options.newReqParams        use these parameters instead of the
 *                                                      original request parameters.
 * @param   {string}        options.titleParamName      the name of the title parameter.
 * @param   {boolean}       options.dropPathAfterTitle  indicating that the redirect should drop
 *                                                      the path after the title parameter.
 *                                                      Typically used for redirects to
 *                                                      another title, where revision & tid would
 *                                                      no longer match.
 * @return  {string}                                    Location header value containing a
 *                                                      relative redirect path.
 */
mwUtil.createRelativeTitleRedirect = (path, req, options) => {
    options = options || {};
    const titleParamName = options.titleParamName || 'title';
    const newReqParams = options.newReqParams || req.params;
    let pathBeforeTitle = path.substring(0, path.indexOf(`{${titleParamName}}`));
    pathBeforeTitle = new URI(pathBeforeTitle, req.params, true).toString();
    // Omit the domain prefix as it could be wrong for node shared between domains
    pathBeforeTitle = pathBeforeTitle.replace(/^\/[^/]+\//, '');
    const pathSuffix = req.uri.toString()
            .replace(/^\/[^/]+\//, '')
            .replace(pathBeforeTitle, '');
    const pathSuffixCount = (pathSuffix.match(/\//g) || []).length;
    const backString = Array.apply(null, { length: pathSuffixCount }).map(() => '../').join('');
    let location;
    if (!options.dropPathAfterTitle) {
        const pathPatternAfterTitle = path.substring(path.indexOf(`{${titleParamName}`) - 1);
        location = backString +
            new URI(pathPatternAfterTitle, newReqParams, true).toString().substr(1) +
            mwUtil.getQueryString(req);
    } else if (/#/.test(newReqParams.title)) {
        const titleFragments = encodeURIComponent(newReqParams.title).split(/%23/);
        /* eslint-disable prefer-template */
        location = backString + titleFragments.shift() + mwUtil.getQueryString(req) +
            '#' + titleFragments.join('%23');
        /* eslint-enable prefer-template */
    } else {
        location = backString + encodeURIComponent(newReqParams.title) + mwUtil.getQueryString(req);
    }

    if (mwUtil.isSelfRedirect(req, location)) {
        location = mwUtil.addQueryString(location, { redirect: false });
    }

    return location;
};

/**
  * Checks if the request is a CORS request
  * @param  {Object}    req The request to check
  * @return {boolean}       Whether the request is CORS or not
  */
mwUtil.isCrossOrigin = (req) => {
    return req && req.headers && req.headers.origin && req.headers.origin !== req.params.domain;
};

const redirectRegEx = /<link rel="mw:PageProp\/redirect" href="\.\/([^"]+)"/;
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

/**
 * Fetches the summary content from the provided URI
 * @param  {HyperSwitch}  hyper     HyperSwitch context
 * @param  {URI}          uri       summary URI
 * @param  {headers}      headers    req header
 * @return {string}                 summary body content
 */
mwUtil.fetchSummary = (mRes, hyper, uri, headers = undefined) => {
    return hyper.get({ uri, headers })
    .then((res) => {
        // Assign content-language and vary header based on one of summary responses
        if (mRes.headers && !mRes.headers['content-language']) {
            mRes.headers['content-language'] = res.headers && res.headers['content-language']
            mwUtil.addVaryHeader(res, 'accept-language');
        }
        res.body.normalizedtitle = res.body.title;
        res.body.title = res.body.title.replace(/ /g, '_');
        return res.body;
    })
    // no need to fail the whole feed request because of one failed summary fetch
    .catchReturn(undefined);
};

/**
 * Traverses through a request body and replaces the given keys with
 * the content fetched using the 'fetch' callback
 * @param  {Object}   response   the response object to hydrate
 * @param  {Function} fetch      the function used to fetch the content if it's not present
 * @return {Promise}             response
 */
mwUtil.hydrateResponse = (response, fetch) => {
    const requests = {};
    const setters = [];

    function _traverse(node, removeFromParent) {
        function requestResource(resource) {
            requests[resource] = requests[resource] || fetch(resource);
            setters.push((content) => {
                if (content[resource]) {
                    Object.assign(node, content[resource]);
                } else if (removeFromParent) {
                    removeFromParent();
                }
                delete node.$merge;
            });
        }

        if (Array.isArray(node)) {
            // If the item is not available we need to delete it from the array
            // using the callback with splice. The callbacks are executed in the same
            // order as they're created here, so reverse the iteration order to
            // make removal of multiple elements work correctly.
            for (let i = node.length - 1; i >= 0; i--) {
                _traverse(node[i], () => node.splice(i, 1));
            }
        } else if (node && typeof node === 'object') {
            if (Array.isArray(node.$merge)) {
                node.$merge.forEach(requestResource);
            } else {
                Object.keys(node).forEach((key) => _traverse(node[key], () => delete node[key]));
            }
        }
    }
    _traverse(response.body);

    return P.props(requests)
    .then((content) => setters.forEach((setter) => setter(content)))
    .thenReturn(response);
};

/**
 * Checks whether the date is today or in the past in UTC-0 timezone
 * @param  {Date}    date   a date to check
 * @return {boolean}        true if the date is in the past
 */
mwUtil.isHistoric = (date) => {
    const now = new Date();
    const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    return date < today;
};

/**
 * Verifies that the date parameter is in proper format.
 * @param {Object} req the request to check
 */
mwUtil.verifyDateParams = (req) => {
    const rp = req.params;

    if (!/^2\d\d\d$/.test(rp.yyyy)) {
        throw new HTTPError({
            status: 400,
            body: {
                type: 'bad_request',
                description: 'Invalid yyyy parameter'
            }
        });
    }

    if (!/^\d\d$/.test(rp.mm) || rp.mm === '00' || rp.mm > '12') {
        throw new HTTPError({
            status: 400,
            body: {
                type: 'bad_request',
                description: 'Invalid mm parameter'
            }
        });
    }

    if (!/^\d\d$/.test(rp.dd) || rp.dd === '00' || rp.dd > '31') {
        throw new HTTPError({
            status: 400,
            body: {
                type: 'bad_request',
                description: 'Invalid dd parameter'
            }
        });
    }
};

/**
 * Safely builds the Date from request parameters
 * @param  {Object} rp  request parameters object
 * @return {Date}       the requested date.
 */
mwUtil.getDateSafe = (rp) => {
    try {
        return new Date(Date.UTC(rp.yyyy, rp.mm - 1, rp.dd));
    } catch (err) {
        throw new HTTPError({
            status: 400,
            body: {
                type: 'bad_request',
                description: 'wrong date format specified'
            }
        });
    }
};

/**
 * From a list of regexes and strings, constructs a regex that
 * matches any of list items
 * @param   {Array.string}     list   array of strings and regexes
 * @return  {Object|undefined}        either a RegExp object or undefined
 */
mwUtil.constructRegex = (list) => {
    let regex = (list || []).map((regexString) => {
        regexString = regexString.trim();
        if (/^\/.+\/$/.test(regexString)) {
            return `(?:${regexString.substring(1, regexString.length - 1)})`;
        }
        // Compare strings, instead
        return `(?:^${decodeURIComponent(regexString)
        .replace(/[-[\]/{}()*+?.\\^$|]/g, '\\$&')}$)`;
    }).join('|');
    regex = regex && regex.length > 0 ? new RegExp(regex) : undefined;
    return regex;
};

/**
 * Remove entries with duplicate 'title' values from an array of objects
 * @param {?Array}      arr Array of page/article objects
 * @param {?Function}   upd Optional function to update the original item based on the duplicate.
 *                          Takes two parameters (orig, dupe): orig - the original object,
 *                          dupe - the duplicate
 * @return {?Array}         arr deduplicated by 'title'
 */
mwUtil.removeDuplicateTitles = (arr, upd) => {
    const titles = {};
    return arr.filter((item, idx, init) => {
        if (titles[item.title]) {
            if (upd) {
                // eslint-disable-next-line no-unused-vars
                let orig = init[init.findIndex((el) => el.title === item.title)];
                orig = upd(orig, item);
            }
            return false;
        }
        titles[item.title] = true;
        return true;
    });
};

/**
 * Checks if the provided path is an HTML route.
 * @param {string}   path the path to check.
 * @return {boolean}
 */
mwUtil.isHTMLRoute = (path) => /\/page\/html\//.test(path);

/**
 * Extracts the version number from the content-type or accept profile.
 * @param {string}            header  the content-type or accept header.
 * @return {string|undefined}
 */
// TODO: in case of the accept header the parsing should be more involved
// since the accept header can provide waited lists.
mwUtil.extractHTMLProfileVersion = (header) => {
    try {
        if (!header) {
            return undefined;
        }
        const parsedHeader = cType.parse(header);
        if (parsedHeader.type !== 'text/html') {
            return undefined;
        }
        const profile = parsedHeader.parameters.profile;
        if (!profile) {
            return undefined;
        }
        const match = profile.match(/\/([^/]+)$/);
        if (!match || !Array.isArray(match) || match.length < 2) {
            return undefined;
        }
        return match[1];
    } catch (e) {
        return undefined;
    }
};

mwUtil.addVaryHeader = (res, vary) => {
    res.headers = res.headers || {};
    if (!res.headers.vary) {
        res.headers.vary = vary;
    } else {
        const varyPortions = res.headers.vary.split(',').map((h) => h.trim().toLowerCase());
        if (!varyPortions.includes(vary.toLowerCase())) {
            varyPortions.push(vary);
            res.headers.vary = varyPortions.join(',');
        }
    }
};

mwUtil.cloneRequest = (req) => {
    if (!req) {
        return;
    }
    return {
        method: req.method,
        uri: req.uri,
        headers: Object.assign({}, req.headers),
        query: req.query,
        body: req.body,
        params: req.params
    };
};

module.exports = mwUtil;
