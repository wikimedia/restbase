'use strict';

const P = require('bluebird');
const HyperSwitch = require('hyperswitch');
const URI = HyperSwitch.URI;
const HTTPError = HyperSwitch.HTTPError;

const uuidv1 = require('uuid').v1;

const mwUtil = require('../lib/mwUtil');

const spec = HyperSwitch.utils.loadSpec(`${__dirname}/parsoid.yaml`);

/**
 * Makes sure we have a meta tag for the tid in our output
 * @param  {string} html original HTML content
 * @param  {string} tid  the tid to insert
 * @return {string}      modified html
 */
function insertTidMeta(html, tid) {
    if (!/<meta property="mw:TimeUuid" [^>]{0,128}>/.test(html)) {
        return html.replace(/(<head [^>]{0,128}>)/,
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

/** HTML resource_change event emission
 * @param   {HyperSwitch}   hyper           the hyperswitch router object
 * @param   {Object}        req             the request
 * @param   {boolean}       [newContent]    whether this is the newest revision
 * @return  {Object}                        update response
 */
function _dependenciesUpdate(hyper, req, newContent = true) {
    // FIXME: we still need to do this purging!
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
        delete this.options.parsoidHost;
        if (!this.parsoidUri) {
            throw new Error('Parsoid module: the option host must be provided!');
        }
        // remove the trailing slash, if any
        if (this.parsoidUri.slice(-1) === '/') {
            this.parsoidUri = this.parsoidUri.slice(0, -1);
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

    _getPageBundleFromParsoid(hyper, req) {
        const rp = req.params;
        let path = `page/pagebundle/${encodeURIComponent(rp.title)}`;

        if (rp.revision) {
            path += `/${rp.revision}`;
        }

        const parsoidReq = this._getParsoidReq(
            req,
            path
        );

        return hyper.get(parsoidReq)
          .then((resp) => {
              return resp;
          }, (error) => {
              throw error;
          });
    }

    getFormat(format, hyper, req) {
        const contentReq = this._getPageBundleFromParsoid(hyper, req);

        return contentReq
            .then((res) => {
                res.headers = res.headers || {};
                if (!res.headers.etag) {
                    res.headers.etag = res.body.html.headers && res.body.html.headers.etag;
                }
                if (!res.headers.etag || /^null$/.test(res.headers.etag)) {
                    // Generate an ETag, for consistency
                    const tid = uuidv1();
                    const revid = res.headers['content-revision-id'] || '0';
                    const etag = mwUtil.makeETag(revid, tid);
                    res.body.html.body = insertTidMeta(res.body.html.body, tid);
                    res.body.html.headers.etag = res.headers.etag = etag;
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
                res.headers['cache-control'] = this.options.response_cache_control;

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
            contentPromise = this._getOriginalContent(hyper, req, rp.revision, tid);
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
                    body_only: req.body.body_only
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

        return hyper.post(parsoidReq);
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

        const disabledStorage = this._isStorageDisabled(req.params.domain);
        let contentReq;

        if (disabledStorage) {
            contentReq = this._getPageBundleFromParsoid(hyper, req);
        } else {
            contentReq = this._getContentWithFallback(hyper, rp.domain, rp.title, revision, tid);
        }

        return contentReq.then((res) => {
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
        operations: ps.operations
    };
};
