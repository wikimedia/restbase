'use strict';

/*
 * Simple wrapper for Parsoid
 */

const P = require('bluebird');
const HyperSwitch = require('hyperswitch');
const URI = HyperSwitch.URI;
const HTTPError = HyperSwitch.HTTPError;

const uuid   = require('cassandra-uuid').TimeUuid;
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
 * Cheap body.innerHTML extraction.
 *
 * This is safe as we know that the HTML we are receiving from Parsoid is
 * serialized as XML.
 * @param  {string} html entire page content
 * @return {string}      body tag innertext
 */
function cheapBodyInnerHTML(html) {
    const match = /<body[^>]*>([\s\S]*)<\/body>/.exec(html);
    if (!match) {
        throw new Error('No HTML body found!');
    } else {
        return match[1];
    }
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
            return revInfo && uuid.fromString(revInfo.tid).getDate() >= jobTime;
        }
    } catch (e) {
        // Ignore errors from date parsing
    }
    return false;
}

/**
 * Replaces sections in original content with sections provided in sectionsJson
 * @param {Object} original     content instance
 * @param {Object} sectionsJson new content
 * @return {string}             new body content
 */
function replaceSections(original, sectionsJson) {
    const sectionOffsets = original['data-parsoid'].body.sectionOffsets;
    const originalBody = cheapBodyInnerHTML(original.html.body);
    let newBody = originalBody;

    const sectionIds = Object.keys(sectionsJson);
    const illegalId = sectionIds.some((id) => !sectionOffsets[id]);
    if (illegalId) {
        throw new HTTPError({
            status: 400,
            body: {
                type: 'bad_request',
                description: 'Invalid section ids'
            }
        });
    }

    function getSectionHTML(id) {
        const htmlOffset = sectionOffsets[id].html;
        return originalBody.substring(htmlOffset[0], htmlOffset[1]);
    }

    function replaceSection(id, replacement) {
        const htmlOffset = sectionOffsets[id].html;
        return newBody.substring(0, htmlOffset[0]) + replacement +
            newBody.substring(htmlOffset[1], newBody.length);
    }

    sectionIds.sort((id1, id2) => sectionOffsets[id2].html[0] - sectionOffsets[id1].html[0])
    .forEach((id) => {
        const sectionReplacement = sectionsJson[id];
        const replacement = sectionReplacement.map((replacePart) => {
            if (replacePart.html) {
                return replacePart.html;
            } else {
                if (!replacePart.id || !sectionOffsets[replacePart.id]) {
                    throw new HTTPError({
                        status: 400,
                        body: {
                            type: 'bad_request',
                            description: 'Invalid section ids',
                            id: replacePart.id
                        }
                    });
                }
                return getSectionHTML(replacePart.id);
            }
        }).join('');
        newBody = replaceSection(id, replacement);
    });
    return `<body>${newBody}</body>`;
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
        this.options = options = options || {};
        this.parsoidHost = options.parsoidHost;

        this._blacklist = compileReRenderBlacklist(options.rerenderBlacklist);

        // Set up operations
        this.operations = {
            getPageBundle: this.pagebundle.bind(this),
            // Revision retrieval per format
            getWikitext: this.getFormat.bind(this, 'wikitext'),
            getHtml: this.getFormat.bind(this, 'html'),
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

    getStashBucketURI(rp, format, tid) {
        const path = [rp.domain, 'sys', 'key_rev_value', `parsoid.stash.${format}-ng`, rp.title];
        if (rp.revision) {
            path.push(rp.revision);
            if (tid) {
                path.push(tid);
            }
        }
        return new URI(path);
    }

    getNGBucketURI(rp, format, tid) {
        const path = [rp.domain, 'sys', 'parsoid_bucket', format, rp.title];
        if (rp.revision) {
            path.push(rp.revision);
            if (tid) {
                path.push(tid);
            }
        }
        return new URI(path);
    }

    getFallbackBucketURI(rp, format, tid) {
        return this.getStashBucketURI(rp, format, tid);
    }

    _getContentWithFallback(hyper, rp, format, tid) {
        return hyper.get({
            uri: this.getNGBucketURI(rp, format, tid)
        })
        .catch({ status: 404 }, (e) => {
            if (rp.revision) {
                return hyper.get({
                    uri: this.getFallbackBucketURI(rp, format, tid)
                });
            } else {
                throw e;
            }
        });
    }

    pagebundle(hyper, req) {
        const rp = req.params;
        const domain = rp.domain;
        const newReq = Object.assign({}, req);
        newReq.method = newReq.method || 'get';
        const path = (newReq.method === 'get') ? 'page' : 'transform/wikitext/to';
        newReq.uri = `${this.parsoidHost}/${domain}/v3/${path}/pagebundle/` +
            `${encodeURIComponent(rp.title)}/${rp.revision}`;
        return hyper.request(newReq);
    }

    saveParsoidResultToLatest(hyper, req, tid, parsoidResp) {
        const rp = req.params;
        return hyper.put({
            uri: this.getNGBucketURI(rp, 'all', tid),
            body: {
                html: parsoidResp.body.html,
                'data-parsoid': parsoidResp.body['data-parsoid']
            }
        });
    }

    saveParsoidResultToFallback(hyper, req, tid, parsoidResp) {
        const rp = req.params;
        return hyper.put({
            uri: this.getFallbackBucketURI(rp, 'data-parsoid', tid),
            headers: parsoidResp.body['data-parsoid'].headers,
            body: parsoidResp.body['data-parsoid'].body
        })
        .then(() => hyper.put({
            uri: this.getFallbackBucketURI(rp, 'html', tid),
            headers: parsoidResp.body.html.headers,
            body: parsoidResp.body.html.body
        }));
    }

    generateAndSave(hyper, req, format, currentContentRes) {
        // Try to generate HTML on the fly by calling Parsoid
        const rp = req.params;
        // Helper for retrieving original content from storage & posting it to
        // the Parsoid pagebundle end point
        /* const getOrigAndPostToParsoid = (pageBundleUri, revision, contentName, updateMode) => {
            return this._getOriginalContent(hyper, req, revision)
            .then((res) => {
                const body = {
                    update: updateMode
                };
                body[contentName] = res;
                return hyper.post({
                    uri: pageBundleUri,
                    headers: {
                        'content-type': 'application/json',
                        'user-agent': req.headers['user-agent'],
                    },
                    body
                });
            }, () => hyper.get({ uri: pageBundleUri })); // Fall back to plain GET
        }; */

        return this.getRevisionInfo(hyper, req)
        .then((revInfo) => {
            rp.revision = revInfo.rev;
        })
        .then(() => {
            const pageBundleUri = new URI([rp.domain, 'sys', 'parsoid', 'pagebundle',
                rp.title, rp.revision]);

            // const parentRev = parseInt(req.headers['x-restbase-parentrevision'], 10);
            // const updateMode = req.headers['x-restbase-mode'];
            const parsoidReq =  hyper.get({ uri: pageBundleUri });
            /* Switched off for the transition period to the new storage model. See T170997.

            if (parentRev) {
                // OnEdit job update: pass along the predecessor version
                parsoidReq = getOrigAndPostToParsoid(pageBundleUri, `${parentRev}`, 'previous');
            } else if (updateMode) {
                // Template or image updates. Similar to html2wt, pass:
                // - current data-parsoid and html
                // - the edit mode
                parsoidReq = getOrigAndPostToParsoid(pageBundleUri, rp.revision,
                        'original', updateMode);
            } else {
                // Plain render
                parsoidReq = hyper.get({ uri: pageBundleUri });
            } */

            return P.join(parsoidReq, mwUtil.decodeBody(currentContentRes))
            .spread((res, currentContentRes) => {
                const tid  = uuid.now().toString();
                res.body.html.body = insertTidMeta(res.body.html.body, tid);

                if (format === 'html' &&
                        currentContentRes &&
                        currentContentRes.status === 200 &&
                        sameHtml(res.body.html.body, currentContentRes.body) &&
                        currentContentRes.headers['content-type'] ===
                                res.body.html.headers['content-type']) {
                    // New render is the same as the previous one, no need to store it.
                    hyper.metrics.increment('sys_parsoid_generateAndSave.unchanged_rev_render');
                    return currentContentRes;
                } else if (res.status === 200) {
                    const resp = {
                        status: res.status,
                        headers: res.body[format].headers,
                        body: res.body[format].body
                    };
                    resp.headers.etag = mwUtil.makeETag(rp.revision, tid);
                    let newContent = true;
                    return this.saveParsoidResultToLatest(hyper, req, tid, res)
                    .catch({ status: 412 }, () => {
                        newContent = false;
                        return this.saveParsoidResultToFallback(hyper, req, tid, res);
                    })
                    .then(() => {
                        // Extract redirect target, if any
                        const redirectTarget = mwUtil.extractRedirect(res.body.html.body);
                        if (redirectTarget) {
                            // This revision is actually a redirect. Pass redirect target
                            // to caller, and let it rewrite the location header.
                            resp.status = 302;
                            resp.headers.location = encodeURIComponent(redirectTarget)
                                .replace(/%23/, '#');
                        }
                    })
                    .then(() => {
                        const dependencyUpdate = _dependenciesUpdate(hyper, req, newContent);
                        if (mwUtil.isNoCacheRequest(req)) {
                            // Finish background updates before returning
                            return dependencyUpdate.thenReturn(resp);
                        } else {
                            return resp;
                        }
                    });
                } else {
                    return res;
                }
            });
        });
    }

    getSections(hyper, req) {
        const rp = req.params;
        const sections = req.query.sections.split(',').map((id) => id.trim());
        delete req.query.sections;

        return this.getFormat('html', hyper, req)
        .then((htmlRes) => {
            const etagInfo = mwUtil.parseETag(htmlRes.headers.etag);
            const sectionsRP = Object.assign({}, rp, {
                revision: etagInfo.rev,
                tid: etagInfo.tid
            });
            return this._getContentWithFallback(hyper, sectionsRP,
                'data-parsoid', sectionsRP.tid)
            .then((dataParsoid) => mwUtil.decodeBody(htmlRes).then((content) => {
                const body = cheapBodyInnerHTML(content.body);
                const chunks = sections.reduce((result, id) => {
                    const offsets = dataParsoid.body.sectionOffsets[id];
                    if (!offsets) {
                        throw new HTTPError({
                            status: 400,
                            body: {
                                type: 'bad_request',
                                detail: `Unknown section id: ${id}`
                            }
                        });
                    }
                    // Offsets as returned by Parsoid are relative to body.innerHTML
                    result[id] = body.substring(offsets.html[0], offsets.html[1]);
                    return result;
                }, {});
                return {
                    status: 200,
                    headers: {
                        etag: htmlRes.headers.etag,
                        'cache-control': 'no-cache',
                        'content-type': 'application/json'
                    },
                    body: chunks
                };
            }));
        });
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
                return this.generateAndSave(hyper, req, format, storageRes);
            } else {
                // Don't generate content if there's some other error.
                throw storageRes;
            }
        };

        if (format === 'html' && req.query.sections) {
            return this.getSections(hyper, req);
        }

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

        let contentReq = this._getContentWithFallback(hyper, rp, format, rp.tid);

        if (mwUtil.isNoCacheRequest(req)) {
            // Check content generation either way
            contentReq = contentReq.then((res) => {
                if (isModifiedSince(req, res)) { // Already up to date, nothing to do.
                    return {
                        status: 412,
                        body: {
                            type: 'precondition_failed',
                            detail: 'The precondition failed'
                        }
                    };
                }
                return generateContent(res);
            }, generateContent);
        } else {
            // Only (possibly) generate content if there was an error
            contentReq = contentReq.catch(generateContent);
        }
        return contentReq
        .then((res) => {
            mwUtil.normalizeContentType(res);
            res.headers = res.headers || {};
            if (this.options.response_cache_control) {
                res.headers['cache-control'] = this.options.response_cache_control;
            }
            if (/^null$/.test(res.headers.etag)) {
                hyper.logger.log('error/parsoid/response_etag_missing', {
                    msg: 'Detected a null etag in the response!'
                });
            }

            return res;
        });
    }

    _getStashedContent(hyper, req, etag) {
        const rp = req.params;
        const getStash = (format) => hyper.get({
            uri: this.getStashBucketURI(rp, format, etag.tid)
        })
        .then(mwUtil.decodeBody);

        return P.props({
            html: getStash('html'),
            'data-parsoid': getStash('data-parsoid'),
            wikitext: getStash('wikitext')
        })
        .then((res) => {
            res.revid = rp.revision;
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
        if (etag && etag.suffix === 'stash' && from === 'html' && to === 'wikitext') {
            contentPromise = this._getStashedContent(hyper, req, etag);
        } else {
            contentPromise = this._getOriginalContent(hyper, req, rp.revision, tid);
        }
        return contentPromise.then((original) => {
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

            const body2 = {
                original
            };
            if (from === 'changes') {
                body2.html = replaceSections(original, req.body.changes);
                from = 'html';
            } else {
                body2[from] = req.body[from];
            }

            body2.scrub_wikitext = req.body.scrub_wikitext;
            body2.body_only = req.body.body_only;

            // Let the stash flag through as well
            if (req.body.stash) {
                body2.stash = true;
            }

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
                body: body2
            };
            return this.callParsoidTransform(hyper, newReq, from, to);
        });

    }

    stashTransform(hyper, req, transformPromise) {
        // A stash has been requested. We need to store the wikitext sent by
        // the client together with the page bundle returned by Parsoid, so it
        // can be later reused when transforming back from HTML to wikitext
        // cf https://phabricator.wikimedia.org/T114548
        const rp = req.params;
        const tid = uuid.now().toString();
        const wtType = req.original && req.original.headers['content-type'] || 'text/plain';
        return transformPromise.then((original) =>
            // Save the returned data-parsoid for the transform and the wikitext sent by the client
            P.all([
                hyper.put({
                    uri: this.getStashBucketURI(rp, 'data-parsoid', tid),
                    headers: original.body['data-parsoid'].headers,
                    body: original.body['data-parsoid'].body
                }),
                hyper.put({
                    uri: this.getStashBucketURI(rp, 'wikitext', tid),
                    headers: { 'content-type': wtType },
                    body: req.body.wikitext
                })
            ])
        // Save HTML last, so that any error in metadata storage suppresses
        // HTML.
        .then(() => hyper.put({
            uri: this.getStashBucketURI(rp, 'html', tid),
            headers: original.body.html.headers,
            body: original.body.html.body
        }))
        // Add the ETag to the original response so it can be propagated
        // back to the client
        .then(() => {
            original.body.html.headers.etag = mwUtil.makeETag(rp.revision, tid, 'stash');
            return original;
        }));
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

        const parsoidReq = {
            uri: `${this.parsoidHost}/${rp.domain}/v3/transform/` +
                `${parsoidFrom}/to/${parsoidTo}${parsoidExtraPath}`,
            headers: {
                'content-type': 'application/json',
                'user-agent': req['user-agent'],
                'content-language': req.headers['content-language'],
                accept: req.headers.accept
            },
            body: req.body
        };

        const transformPromise = hyper.post(parsoidReq);
        if (req.body.stash && from === 'wikitext' && to === 'html') {
            return this.stashTransform(hyper, req, transformPromise);
        }
        return transformPromise;

    }

    getLintErrors(hyper, req) {
        const rp = req.params;
        let path = `${this.parsoidHost}/${rp.domain}/v3/transform/` +
            `wikitext/to/lint/${encodeURIComponent(rp.title)}`;
        if (rp.revision) {
            path += `/${rp.revision}`;
        }
        return hyper.post({ uri: path });
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
        const get = (format) => {
            const path = [rp.domain, 'sys', 'parsoid', format, rp.title, revision];
            if (tid) {
                path.push(tid);
            }
            return hyper.get({ uri: new URI(path) }).then(mwUtil.decodeBody);
        };

        return P.props({
            html: get('html'),
            'data-parsoid': get('data-parsoid')
        })
        .then((res) => {
            res.revid = revision;
            return res;
        });
    }
}

module.exports = (options) => {
    options = options || {};
    const ps = new ParsoidService(options);

    return {
        spec,
        operations: ps.operations,
        // Dynamic resource dependencies, specific to implementation
        resources: [
            // stashing resources for HTML, wikitext and data-parsoid
            {
                uri: '/{domain}/sys/key_rev_value/parsoid.stash.html-ng',
                body: {
                    valueType: 'blob',
                    version: 3,
                    default_time_to_live: options.grace_ttl
                }
            },
            {
                // TODO: the `-ng` is only here because we have just one cass cluster
                // in dev. Remove before deploying to production
                uri: '/{domain}/sys/key_rev_value/parsoid.stash.wikitext-ng',
                body: {
                    valueType: 'blob',
                    version: 3,
                    default_time_to_live: options.grace_ttl
                }
            },
            {
                // TODO: the `-ng` is only here because we have just one cass cluster
                // in dev. Remove before deploying to production
                uri: '/{domain}/sys/key_rev_value/parsoid.stash.data-parsoid-ng',
                body: {
                    valueType: 'json',
                    version: 3,
                    default_time_to_live: options.grace_ttl
                }
            },
            {
                uri: '/{domain}/sys/parsoid_bucket/'
            }
        ]
    };
};
