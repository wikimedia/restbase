'use strict';

const P = require('bluebird');
const HyperSwitch = require('hyperswitch');
const URI = HyperSwitch.URI;
const HTTPError = HyperSwitch.HTTPError;

const uuidv1 = require('uuid').v1;
const uuidUtils = require('../lib/uuidUtils');

const mwUtil = require('../lib/mwUtil');

const spec = HyperSwitch.utils.loadSpec(`${__dirname}/parsoid.yaml`);

// Temporary work-around for Parsoid issue
// https://phabricator.wikimedia.org/T93715
function normalizeHtml(html) {
    return html && html.toString &&
        html.toString()
            .replace(/ about="[^"]+"(?=[/> ])|<meta property="mw:TimeUuid"[^>]+>/g, '');
}
function sameHtml(a, b) {
    return normalizeHtml(a) === normalizeHtml(b);
}

/**
 * Makes sure we have a meta tag for the tid in our output
 * @param  {string} html original HTML content
 * @param  {string} tid  the tid to insert
 * @return {string}      modified html
 */
function insertTidMeta(html, tid) {
    if (!/<meta property="mw:TimeUuid" [^>]+>/.test(html)) {
        return html.replace(/(<head [^>]+>)/,
            `$1<meta property="mw:TimeUuid" content="${tid}"/>`);
    }
    return html;
}

function extractTidMeta(html) {
    // Fall back to an inline meta tag in the HTML
    const tidMatch = new RegExp('<meta\\s+(?:content="([^"]+)"\\s+)?' +
        'property="mw:TimeUuid"(?:\\s+content="([^"]+)")?\\s*\\/?>')
        .exec(html);
    return tidMatch && (tidMatch[1] || tidMatch[2]);
}

/**
 *  Checks whether the content has been modified since the timestamp
 *  in `if-unmodified-since` header of the request
 * @param  {Object} req the request
 * @param  {Object} res the response
 * @return {boolean}    true if content has beed modified
 */
function isModifiedSince(req, res) {
    try {
        if (req.headers['if-unmodified-since']) {
            const jobTime = Date.parse(req.headers['if-unmodified-since']);
            const revInfo = mwUtil.parseETag(res.headers.etag);
            return revInfo && uuidUtils.getDate(revInfo.tid) >= jobTime;
        }
    } catch (e) {
        // Ignore errors from date parsing
    }
    return false;
}

/** HTML resource_change event emission
 * @param   {HyperSwitch}   hyper           the hyperswitch router object
 * @param   {Object}        req             the request
 * @param   {boolean}       [newContent]    whether this is the newest revision
 * @return  {Object}                        update response
 */
function _dependenciesUpdate(hyper, req, newContent = true) {
    const rp = req.params;
    return mwUtil.getSiteInfo(hyper, req)
        .then((siteInfo) => {
            const baseUri = siteInfo.baseUri.replace(/^https?:/, '');
            const publicURI = `${baseUri}/page/html/${encodeURIComponent(rp.title)}`;
            const body = [ { meta: { uri: `${publicURI}/${rp.revision}` } } ];
            if (newContent) {
                body.push({ meta: { uri: publicURI } });
            }
            return hyper.post({
                uri: new URI([rp.domain, 'sys', 'events', '']),
                body
            }).catch((e) => {
                hyper.logger.log('warn/bg-updates', e);
            });
        });
}

function compileReRenderBlacklist(blacklist) {
    const result = {};
    blacklist = blacklist || {};
    Object.keys(blacklist).forEach((domain) => {
        result[domain] = mwUtil.constructRegex(blacklist[domain]);
    });
    return result;
}

class ParsoidService {
    constructor(options) {
        this._initOpts(options);

        this.operations = {
            // Revision retrieval per format
            getHtml: this.getFormatAndCheck.bind(this, 'html'),
            getDataParsoid: this.getFormat.bind(this, 'data-parsoid'),
            getLintErrors: this.getLintErrors.bind(this),
            // Transforms
            transformHtmlToHtml: this.makeTransform('html', 'html'),
            transformHtmlToWikitext: this.makeTransform('html', 'wikitext'),
            transformWikitextToHtml: this.makeTransform('wikitext', 'html'),
            transformWikitextToLint: this.makeTransform('wikitext', 'lint'),
            transformChangesToWikitext: this.makeTransform('changes', 'wikitext')
        };
    }

    _initOpts(opts = {}) {
        this.options = opts;
        this.parsoidUri = opts.host || opts.parsoidHost;
        this.options.stash_ratelimit = opts.stash_ratelimit || 5;
        delete this.options.parsoidHost;
        this._blacklist = compileReRenderBlacklist(opts.rerenderBlacklist);
        if (!this.parsoidUri) {
            throw new Error('Parsoid module: the option host must be provided!');
        }
        // remove the trailing slash, if any
        if (this.parsoidUri.slice(-1) === '/') {
            this.parsoidUri = this.parsoidUri.slice(0, -1);
        }
    }

    _checkStashRate(hyper, req) {
        if (!hyper.ratelimiter) {
            return;
        }
        if (hyper._rootReq.headers['x-request-class'] !== 'external') {
            return;
        }
        if (!((req.query && req.query.stash) || (req.body && req.body.stash))) {
            return;
        }
        const key = `${hyper.config.service_name}.parsoid_stash|` +
            `${hyper._rootReq.headers['x-client-ip']}`;
        if (hyper.ratelimiter.isAboveLimit(key, this.options.stash_ratelimit)) {
            hyper.logger.log('warn/parsoid/stashlimit', {
                key,
                rate_limit_per_second: this.options.stash_ratelimit,
                message: 'Stashing rate limit exceeded'
            });
            throw new HTTPError({
                status: 429,
                body: {
                    type: 'request_rate_exceeded',
                    title: 'Stashing rate limit exceeded',
                    rate_limit_per_second: this.options.stash_ratelimit
                }
            });
        }
    }

    /**
     * Assembles the request that is to be used to call the Parsoid service
     *
     * @param {Object} req the original request received by the module
     * @param {string} path the path portion of the URI, without the domain or API version
     * @param {Object} [headers] the headers to send, defaults to req.headers
     * @param {Object} [body] the body of the request, defaults to undefined
     * @return {Object} the request object to send
     */
    _getParsoidReq(req, path, headers, body) {
        return {
            uri: new URI(`${this.parsoidUri}/${req.params.domain}/v3/${path}`),
            headers: Object.assign({ host: req.params.domain }, headers || {}),
            body
        };
    }

    /**
     * Gets the URI of a bucket for the latest Parsoid content
     *
     * @param {string} domain the domain name
     * @param {string} title the article title
     * @return {HyperSwitch.URI}
     */
    _getLatestBucketURI(domain, title) {
        return new URI([
            domain, 'sys', 'key_value', 'parsoidphp', title
        ]);
    }

    /**
     * Gets the URI of a bucket for stashing Parsoid content. Used both for stashing
     * original HTML/Data-Parsoid for normal edits as well as for stashing transforms
     *
     * @param {string} domain the domain name
     * @param {string} title the article title
     * @param {number} revision the revision of the article
     * @param {string} tid the TID of the content
     * @return {HyperSwitch.URI}
     */
    _getStashBucketURI(domain, title, revision, tid) {
        return new URI([
            domain, 'sys', 'key_value', 'parsoidphp-stash', `${title}:${revision}:${tid}`
        ]);
    }

    getFormatAndCheck(format, hyper, req) {
        return this.getFormat(format, hyper, req)
            .tap((res) => {
                // TEMP TEMP TEMP: T236382 / T221174 shim content-language and vary if missing
                if (!res.headers['content-language'] || !res.headers.vary) {
                    hyper.logger.log('warn/parsoidphp/headers', {
                        msg: 'Missing Content-Language or Vary header in pb.body.html.headers'
                    });
                }
                res.headers['content-language'] = res.headers['content-language'] || 'en';
                res.headers.vary = res.headers.vary || 'Accept';
                // END TEMP
            });
    }

    /**
     * Get full content from the stash bucket.
     * @param {HyperSwitch} hyper the hyper object to route requests
     * @param {string} domain the domain name
     * @param {string} title the article title
     * @param {number} revision the article revision
     * @param {string} tid the render TID
     * @return {Promise<Object>} the promise resolving to full stashed Parsoid
     * response or a stashed transform
     * @private
     */
    _getStashedContent(hyper, domain, title, revision, tid) {
        return hyper.get({
            uri: this._getStashBucketURI(domain, title, revision, tid)
        })
            .then((res) => {
                res = res.body;
                res.revid = revision;
                return res;
            });
    }

    _saveParsoidResultToFallback(hyper, req, parsoidResp) {
        const rp = req.params;
        const dataParsoidResponse = parsoidResp.body['data-parsoid'];
        const htmlResponse = parsoidResp.body.html;
        const etag = mwUtil.parseETag(parsoidResp.headers.etag);
        return hyper.put({
            uri: this._getStashBucketURI(rp.domain, rp.title, etag.rev, etag.tid),
            // Note. The headers we are storing here are for the whole pagebundle response.
            // The individual components of the pagebundle contain their own headers that
            // which are used to generate actual responses.
            headers: {
                'x-store-etag': parsoidResp.headers.etag,
                'content-type': 'application/octet-stream',
                'x-store-content-type': 'application/json'
            },
            body: Buffer.from(JSON.stringify({
                'data-parsoid': dataParsoidResponse,
                html: htmlResponse
            }))
        });
    }

    /**
     * Saves the Parsoid pagebundle result to the latest bucket.
     * // TODO: Optimization opportunity. We look what's in the
     * // latest bucket yet again and make the store request a no-op if
     * // it's not really the latest content, but we have already looked into
     * // the latest bucket, thus we can somehow pass the data over here
     * // so that we don't do several checks.
     * @param {HyperSwitch} hyper the hyper object for request routing
     * @param {string} domain the domain name
     * @param {string} title the page title
     * @param {Object} parsoidResp the response received from Parsoid.
     * @return {Promise<Object>}
     */
    saveParsoidResultToLatest(hyper, domain, title, parsoidResp) {
        const dataParsoidResponse = parsoidResp.body['data-parsoid'];
        const htmlResponse = parsoidResp.body.html;
        return hyper.get({ uri: this._getLatestBucketURI(domain, title) })
            .then((existingRes) => {
                // TODO: This is a race condition and we're doing a write after read
                // in a distributed concurrent environment. For revisions this should
                // not be a big problem, but once(if) we start supporting lightweight transactions
                // in the storage component, we might want to rethink this.
                const existingRev = mwUtil.parseETag(existingRes.headers.etag).rev;
                const newRev = mwUtil.parseETag(parsoidResp.headers.etag).rev;
                if (Number.parseInt(newRev, 10) >= Number.parseInt(existingRev, 10)) {
                    throw new HTTPError({ status: 412 });
                }
                return existingRes;
            })
            .catch({ status: 404 }, { status: 412 }, () => hyper.put({
                uri: this._getLatestBucketURI(domain, title),
                // Note. The headers we are storing here are for the whole pagebundle response.
                // The individual components of the pagebundle contain their own headers that
                // which are used to generate actual responses.
                headers: {
                    'x-store-etag': htmlResponse.headers.etag,
                    'content-type': 'application/octet-stream',
                    'x-store-content-type': 'application/json'
                },
                body: Buffer.from(JSON.stringify({
                    'data-parsoid': dataParsoidResponse,
                    html: htmlResponse
                }))
            }));
    }

    stashTransform(hyper, req, transformPromise) {
        // A stash has been requested. We need to store the wikitext sent by
        // the client together with the page bundle returned by Parsoid, so it
        // can be later reused when transforming back from HTML to wikitext
        // cf https://phabricator.wikimedia.org/T114548
        const rp = req.params;
        const tid = uuidv1();
        const etag = mwUtil.makeETag(rp.revision, tid, 'stash');
        const wtType = req.original && req.original.headers['content-type'] || 'text/plain';
        return transformPromise.then((original) => hyper.put({
            uri: this._getStashBucketURI(rp.domain, rp.title, rp.revision, tid),
            headers: {
                'x-store-etag': etag,
                'content-type': 'application/octet-stream',
                'x-store-content-type': 'application/json'
            },
            body: Buffer.from(JSON.stringify({
                'data-parsoid': original.body['data-parsoid'],
                wikitext: {
                    headers: { 'content-type': wtType },
                    body: req.body.wikitext
                },
                html: original.body.html
            }))
        })
        // Add the ETag to the original response so it can be propagated back to the client
            .then(() => {
                original.body.html.headers.etag = etag;
                return original;
            }));
    }

    /**
     * Returns the content with fallback to the stash. Revision and TID are optional.
     * If only 'title' is provided, only 'latest' bucket is checked.
     * If 'title' and 'revision' are provided, first the 'latest' bucket is checked.
     *  Then, the stored revision is compared, if they do not equal, 404 is returned
     *  as we can not check the stash with no tid provided.
     *  If all the 'title', 'revision' and 'tid' are provided,
     *  we check the latest bucket first, and then the stash bucket.
     * @param {HyperSwitch} hyper the hyper object to rout requests
     * @param {string} domain the domain name
     * @param {string} title the article title
     * @param {number} [revision] the article revision
     * @param {string} [tid] the render TID
     * @return {Promise<Object>} the promise that resolves to full stashed Parsoid response
     * @private
     */
    _getContentWithFallback(hyper, domain, title, revision, tid) {
        if (!revision && !tid) {
            return hyper.get({ uri: this._getLatestBucketURI(domain, title) });
        } else if (!tid) {
            return hyper.get({ uri: this._getLatestBucketURI(domain, title) })
                .then((res) => {
                    const resEtag = mwUtil.parseETag(res.headers.etag);
                    if (revision !== resEtag.rev) {
                        throw new HTTPError({ status: 404 });
                    }
                    return res;
                });
        } else {
            return hyper.get({
                uri: this._getStashBucketURI(domain, title, revision, tid)
            })
                .catch({ status: 404 }, () =>
                    hyper.get({ uri: this._getLatestBucketURI(domain, title) })
                        .then((res) => {
                            const resEtag = mwUtil.parseETag(res.headers.etag);
                            if (revision !== resEtag.rev || tid !== resEtag.tid) {
                                throw new HTTPError({ status: 404 });
                            }
                            return res;
                        })
                );
        }
    }

    _getPageBundleFromParsoid(hyper, req) {
        const rp = req.params;
        return hyper.get(this._getParsoidReq(
            req,
            `page/pagebundle/${encodeURIComponent(rp.title)}/${rp.revision}`
        ));
    }

    /**
     * Generate content and store it in the latest bucket if the content is indeed
     * newer then the original content we have fetched.
     * @param {HyperSwitch} hyper the hyper object for request routing
     * @param {Object} req the original request
     * @param {Object} currentContentRes the pagebundle received from latest or fallback bucket.
     * @return {Promise<Object>}
     */
    generateAndSave(hyper, req, currentContentRes) {
        // Try to generate HTML on the fly by calling Parsoid
        const rp = req.params;
        return this.getRevisionInfo(hyper, req)
            .then((revInfo) => {
                rp.revision = revInfo.rev;
            })
            .then(() => P.join(this._getPageBundleFromParsoid(hyper, req), currentContentRes)
                .spread((res, currentContentRes) => {
                    const tid = uuidv1();
                    const etag = mwUtil.makeETag(rp.revision, tid);
                    res.body.html.body = insertTidMeta(res.body.html.body, tid);
                    res.body.html.headers.etag = res.headers.etag = etag;

                    if (currentContentRes &&
                        currentContentRes.status === 200 &&
                        sameHtml(res.body.html.body, currentContentRes.body.html.body) &&
                        currentContentRes.body.html.headers['content-type'] ===
                        res.body.html.headers['content-type']) {
                        // New render is the same as the previous one, no need to store it.
                        hyper.metrics.increment('sys_parsoid_generateAndSave.unchanged_rev_render');
                        return currentContentRes;
                    } else if (res.status === 200) {
                        let newContent = false;
                        return this.saveParsoidResultToLatest(hyper, rp.domain, rp.title, res)
                            .then((saveRes) => {
                                if (saveRes.status === 201) {
                                    newContent = true;
                                }
                                // Extract redirect target, if any
                                const redirectTarget = mwUtil.extractRedirect(res.body.html.body);
                                if (redirectTarget) {
                                    // This revision is actually a redirect. Pass redirect target
                                    // to caller, and let it rewrite the location header.
                                    res.status = 302;
                                    res.headers.location = encodeURIComponent(redirectTarget)
                                        .replace(/%23/, '#');
                                }
                            })
                            .then(() => {
                                let dependencyUpdate = P.resolve();
                                if (!this.options.skip_updates) {
                                    dependencyUpdate = _dependenciesUpdate(hyper, req, newContent);
                                }
                                if (mwUtil.isNoCacheRequest(req)) {
                                    // Finish background updates before returning
                                    return dependencyUpdate.thenReturn(res);
                                } else {
                                    return res;
                                }
                            });
                    } else {
                        return res;
                    }
                }));
    }

    /**
     * Internal check to see if it's okay to re-render a particular title in
     * response to a no-cache request.
     *
     * TODO: Remove this temporary code once
     * https://phabricator.wikimedia.org/T120171 and
     * https://phabricator.wikimedia.org/T120972 are resolved / resource
     * consumption for these articles has been reduced to a reasonable level.
     * @param  {Request} req    the request being processed
     * @return {boolean}        Whether re-rendering this title is okay.
     */
    _okayToRerender(req) {
        if (mwUtil.isNoCacheRequest(req) && this._blacklist[req.params.domain]) {
            return !this._blacklist[req.params.domain].test(req.params.title);
        }
        return true;
    }

    getFormat(format, hyper, req) {
        const rp = req.params;
        const generateContent = (storageRes) => {
            if (!rp.tid && (storageRes.status === 404 || storageRes.status === 200)) {
                return this.generateAndSave(hyper, req, storageRes);
            } else {
                // Don't generate content if there's some other error.
                throw storageRes;
            }
        };

        if (!this._okayToRerender(req)) {
            // Still update the revision metadata.
            return this.getRevisionInfo(hyper, req)
                .then(() => {
                    throw new HTTPError({
                        status: 403,
                        body: {
                            type: 'bad_request#rerenders_disabled',
                            description: 'Rerenders for this article are blacklisted in the config.'
                        }
                    });
                });
        }

        // check the rate limit for stashing requests
        this._checkStashRate(hyper, req);

        let contentReq =
            this._getContentWithFallback(hyper, rp.domain, rp.title, rp.revision, rp.tid);

        if (mwUtil.isNoCacheRequest(req)) {
            // Check content generation either way
            contentReq = contentReq.then((res) => {
                if (isModifiedSince(req, res)) { // Already up to date, nothing to do.
                    throw new HTTPError({
                        status: 412,
                        body: {
                            type: 'precondition_failed',
                            detail: 'The precondition failed'
                        }
                    });
                }
                return generateContent(res);
            }, generateContent);
        } else {
            // Only (possibly) generate content if there was an error
            contentReq = contentReq.catch(generateContent);
        }
        return contentReq
            .then((res) => {
                res.headers = res.headers || {};
                if (!res.headers.etag) {
                    res.headers.etag = res.body.html.headers && res.body.html.headers.etag;
                }
                if (!res.headers.etag || /^null$/.test(res.headers.etag)) {
                    // if there is no ETag, we *could* create one here, but this
                    // would mean at least cache pollution, and would hide the
                    // fact that we have incomplete data in storage, so error out
                    hyper.logger.log('error/parsoid/response_etag_missing', {
                        msg: 'Detected a null etag in the response!'
                    });
                    throw new HTTPError({
                        status: 500,
                        body: {
                            title: 'no_etag',
                            description: 'No ETag has been provided in the response'
                        }
                    });
                }
                if (req.query.stash) {
                    return this._saveParsoidResultToFallback(hyper, req, res)
                        .thenReturn(res);
                }
                return res;
            })
            .then((res) => {
                const etag = res.headers.etag;
                // Chop off the correct format to return.
                res = Object.assign({ status: res.status }, res.body[format]);
                res.headers = res.headers || {};
                res.headers.etag = etag;
                mwUtil.normalizeContentType(res);
                if (req.query.stash) {
                    // The stash is used by clients that want further support
                    // for transforming the content. If the content is stored in caches,
                    // subsequent requests might not even reach RESTBase and the stash
                    // will expire, thus no-cache.
                    res.headers['cache-control'] = 'no-cache';
                } else if (this.options.response_cache_control) {
                    res.headers['cache-control'] = this.options.response_cache_control;
                }

                return res;
            });
    }

    transformRevision(hyper, req, from, to) {
        const rp = req.params;

        const etag = req.headers && mwUtil.parseETag(req.headers['if-match']);
        // Prefer the If-Match header
        let tid = etag && etag.tid;

        if (from === 'html') {
            if (req.body && req.body.html) {
                // Fall back to an inline meta tag in the HTML
                const htmlTid = extractTidMeta(req.body.html);
                if (tid && htmlTid && htmlTid !== tid) {
                    hyper.logger.log('error/parsoid/etag_mismatch', {
                        msg: 'Client-supplied etag did not match mw:TimeUuid!'
                    });
                } else if (tid && etag.tidSuffix) {
                    // T230272: the TID has a suffix, just log this
                    // occurrence and continue with the original value
                    hyper.logger.log('warn/parsoid/etag_tidsuffix', {
                        msg: 'Client-supplied etag TID has a suffix',
                        tid,
                        suffix: etag.tidSuffix
                    });
                } else if (!tid) {
                    tid = htmlTid;
                    hyper.logger.log('warn/parsoid/etag', {
                        msg: 'Client did not supply etag, fallback to mw:TimeUuid meta element'
                    });
                }
            }
            if (!tid) {
                throw new HTTPError({
                    status: 400,
                    body: {
                        type: 'bad_request',
                        description: 'No or invalid If-Match header supplied, ' +
                            'or missing mw:TimeUuid meta element in the supplied HTML.'
                    }
                });
            }
        }

        let contentPromise;
        if (from === 'wikitext') {
            // For transforming from wikitext Parsoid currently doesn't use the original
            // content. It could be used for optimizing the template expansions. See T98995
            // Note: when resurrecting sending the original content to Parsoid we should
            // account for the possibility that it's not in storage, so contentPromise might
            // reject with 404. In this case we would just not provide it.
            contentPromise = P.resolve(undefined);
        } else {
            if (etag && etag.suffix === 'stash' && from === 'html' && to === 'wikitext') {
                // T235465: RB should trust its own ETag over the client-supplied revision, but
                // allow for the client to be right, so provide their revision as a fall-back
                const revMismatch = etag.rev !== rp.revision;
                if (revMismatch) {
                    // the ETag and URI parameter do not agree, log this (for now?)
                    hyper.logger.log('warn/parsoid/etag_rev', {
                        msg: 'The revisions in If-Match and URI differ'
                    });
                }
                contentPromise = this._getStashedContent(hyper, rp.domain,
                    rp.title, etag.rev, etag.tid)
                    .catch({ status: 404 }, (e) => {
                        if (!revMismatch) {
                            // the revisions match, so this is a genuine 404
                            throw e;
                        }
                        return this._getStashedContent(
                            hyper, rp.domain, rp.title, rp.revision, tid);
                    });
            } else {
                contentPromise = this._getOriginalContent(hyper, req, rp.revision, tid);
            }
            contentPromise = contentPromise
                .tap((original) => {
                    // Check if parsoid metadata is present as it's required by parsoid.
                    if (!original['data-parsoid'].body ||
                        original['data-parsoid'].body.constructor !== Object ||
                        !original['data-parsoid'].body.ids) {
                        throw new HTTPError({
                            status: 400,
                            body: {
                                type: 'bad_request',
                                description: 'The page/revision has no associated Parsoid data'
                            }
                        });
                    }
                });
        }
        return contentPromise.then((original) => {
            const path = [rp.domain, 'sys', 'parsoid', 'transform', from, 'to', to];
            if (rp.title) {
                path.push(rp.title);
                if (rp.revision) {
                    path.push(rp.revision);
                }
            }
            const newReq = {
                uri: new URI(path),
                params: req.params,
                headers: {
                    'content-type': 'application/json',
                    'user-agent': req['user-agent']
                },
                body: {
                    original,
                    [from]: req.body[from],
                    scrub_wikitext: req.body.scrub_wikitext,
                    body_only: req.body.body_only,
                    stash: req.body.stash
                }
            };
            return this.callParsoidTransform(hyper, newReq, from, to);
        });

    }

    callParsoidTransform(hyper, req, from, to) {
        const rp = req.params;
        let parsoidTo = to;
        if (to === 'html') {
            // Retrieve pagebundle whenever we want HTML
            parsoidTo = 'pagebundle';
            req.headers.accept = req.headers.accept && req.headers.accept
                .replace(/\/HTML\//i, '/pagebundle/')
                .replace(/text\/html/, 'application/json');
        }
        let parsoidFrom = from;
        if (from === 'html' && req.body.original) {
            parsoidFrom = 'pagebundle';
        }
        const parsoidExtras = [];
        if (rp.title) {
            parsoidExtras.push(rp.title);
        } else {
            // Fake title to avoid Parsoid error: <400/No title or wikitext was provided>
            parsoidExtras.push('Main_Page');
        }
        if (rp.revision && rp.revision !== '0') {
            parsoidExtras.push(rp.revision);
        }
        let parsoidExtraPath = parsoidExtras.map(encodeURIComponent).join('/');
        if (parsoidExtraPath) {
            parsoidExtraPath = `/${parsoidExtraPath}`;
        }

        const parsoidReq = this._getParsoidReq(
            req,
            `transform/${parsoidFrom}/to/${parsoidTo}${parsoidExtraPath}`,
            {
                'content-type': 'application/json',
                'user-agent': req['user-agent'],
                'content-language': req.headers['content-language'],
                accept: req.headers.accept,
                'accept-language': req.headers['accept-language']
            },
            req.body
        );

        const transformPromise = hyper.post(parsoidReq);
        if (req.body.stash && from === 'wikitext' && to === 'html') {
            return this.stashTransform(hyper, req, transformPromise);
        }
        return transformPromise;

    }

    getLintErrors(hyper, req) {
        const rp = req.params;
        let path = `transform/wikitext/to/lint/${encodeURIComponent(rp.title)}`;
        if (rp.revision) {
            path += `/${rp.revision}`;
        }
        const parsoidReq = this._getParsoidReq(req, path, {}, {});
        parsoidReq.followRedirect = false;
        return hyper.post(parsoidReq).then((res) => {
            if (res.status === 307) {
                // Handle redirect - workaround for Parsoid bug
                // redirect generated for Host, not the domain where Parsoid was called.
                const nloc = new URI(res.headers.location);
                const revision = nloc.path.slice(-1)[0];
                const npath = `${path}/${revision}`;
                return hyper.post(this._getParsoidReq(req, npath, {}, {}));
            }
            return res;
        });
    }

    makeTransform(from, to) {
        return (hyper, req) => {
            const rp = req.params;
            if ((!req.body && req.body !== '') ||
                // The html/to/html endpoint is a bit different so the `html`
                // might not be provided.
                (!(from === 'html' && to === 'html') &&
                    !req.body[from] && req.body[from] !== '')) {
                throw new HTTPError({
                    status: 400,
                    body: {
                        type: 'bad_request',
                        description: `Missing request parameter: ${from}`
                    }
                });
            }
            // check if we have all the info for stashing
            if (req.body.stash) {
                if (!rp.title) {
                    throw new HTTPError({
                        status: 400,
                        body: {
                            type: 'bad_request',
                            description: 'Data can be stashed only for a specific title.'
                        }
                    });
                }
                if (!rp.revision) {
                    rp.revision = '0';
                }
                // check the rate limit for stashing requests
                this._checkStashRate(hyper, req);
            }

            let transform;
            if (rp.revision && rp.revision !== '0') {
                transform = this.transformRevision(hyper, req, from, to);
            } else {
                transform = this.callParsoidTransform(hyper, req, from, to);
            }
            return transform
                .catch((e) => {
                    // In case a page was deleted/revision restricted while edit was happening,
                    // return 410 Gone or 409 Conflict error instead of a general 400
                    const pageDeleted = e.status === 404 && e.body &&
                        /Page was deleted/.test(e.body.description);
                    const revisionRestricted = e.status === 403 && e.body &&
                        /Access is restricted/.test(e.body.description);
                    if (pageDeleted || revisionRestricted) {
                        throw new HTTPError({
                            status: pageDeleted ? 410 : 409,
                            body: {
                                type: 'conflict',
                                title: 'Conflict detected',
                                description: e.body.description
                            }
                        });
                    }
                    throw e;
                })
                .then((res) => {
                    if (to !== 'wikitext' && to !== 'lint') {
                        // Unwrap to the flat response format
                        res = res.body[to];
                        res.status = 200;
                    }
                    // normalise the content type
                    mwUtil.normalizeContentType(res);
                    // remove the content-length header since that
                    // is added automatically
                    delete res.headers['content-length'];
                    return res;
                });
        };
    }

    // Get / check the revision metadata for a request
    getRevisionInfo(hyper, req) {
        const rp = req.params;
        const path = [rp.domain, 'sys', 'page_revisions', 'page', rp.title];
        if (/^(?:[0-9]+)$/.test(rp.revision)) {
            path.push(rp.revision);
        } else if (rp.revision) {
            throw new Error(`Invalid revision: ${rp.revision}`);
        }

        return hyper.get({
            uri: new URI(path),
            headers: {
                'cache-control': req.headers && req.headers['cache-control']
            }
        })
            .then((res) => res.body.items[0]);
    }

    _getOriginalContent(hyper, req, revision, tid) {
        const rp = req.params;
        return this._getContentWithFallback(hyper, rp.domain, rp.title, revision, tid)
            .then((res) => {
                res = res.body;
                res.revid = revision;
                return res;
            });
    }
}

module.exports = (options = {}) => {
    const ps = new ParsoidService(options);
    return {
        spec,
        operations: ps.operations,
        // Dynamic resource dependencies, specific to implementation
        resources: [
            {
                uri: '/{domain}/sys/key_value/parsoidphp',
                headers: {
                    'content-type': 'application/json'
                },
                body: {
                    valueType: 'blob'
                }
            },
            {
                uri: '/{domain}/sys/key_value/parsoidphp-stash',
                headers: {
                    'content-type': 'application/json'
                },
                body: {
                    valueType: 'blob',
                    default_time_to_live: options.grace_ttl || 86400
                }
            }
        ]
    };
};
