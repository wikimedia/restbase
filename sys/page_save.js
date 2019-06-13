'use strict';

/**
 * Page_save module
 *
 * Sends the HTML or wikitext of a page to the MW API for saving
 */

const P = require('bluebird');
const HyperSwitch = require('hyperswitch');
const URI = HyperSwitch.URI;
const HTTPError = HyperSwitch.HTTPError;
const mwUtil = require('../lib/mwUtil');
const uuidUtils = require('../lib/uuidUtils');

class PageSave {
    saveWikitext(hyper, req) {
        const rp = req.params;
        let promise = P.resolve({});
        this._checkParams(req.body);
        const baseRevision = this._getBaseRevision(req);
        if (baseRevision) {
            promise = this._getRevInfo(hyper, req, baseRevision);
        }
        return promise.then((revInfo) => {
            const body = {
                title: rp.title,
                text: req.body.wikitext,
                summary: req.body.comment || req.body.wikitext.substr(0, 100),
                minor: !!req.body.is_minor,
                bot: !!req.body.is_bot,
                token: req.body.csrf_token
            };
            // We need to add each info separately
            // since the presence of an empty value
            // might startle the MW API
            if (revInfo.rev) {
                // For forward compat with https://gerrit.wikimedia.org/r/#/c/94584
                body.parentrevid = revInfo.rev;
            }
            if (revInfo.timestamp) {
                // TODO: remove once the above patch gets merged
                body.basetimestamp = revInfo.timestamp;
            }
            body.starttimestamp = this._getStartTimestamp(req);
            return hyper.post({
                uri: new URI([rp.domain, 'sys', 'action', 'edit']),
                headers: {
                    cookie: req.headers.cookie
                },
                body
            });
        });
    }

    saveHtml(hyper, req) {
        const rp = req.params;
        this._checkParams(req.body);
        // First transform the HTML to wikitext via the parsoid module
        const path = [rp.domain, 'sys', 'parsoid', 'transform', 'html', 'to', 'wikitext', rp.title];
        const baseRevision = this._getBaseRevision(req);
        if (baseRevision) {
            path.push(baseRevision);
        }
        return hyper.post({
            uri: new URI(path),
            body: {
                html: req.body.html
            },
            headers: {
                'if-match': req.body.base_etag || req.headers['if-match']
            }
        })
        .then((res) => {
            // Then send it to the MW API
            req.body.wikitext = res.body;
            delete req.body.html;
            return this.saveWikitext(hyper, req);
        });
    }

    _getStartTimestamp(req) {
        if (!req.headers || !req.headers['if-match']) {
            return;
        }
        const etag = mwUtil.parseETag(req.headers['if-match']);
        if (!etag || !uuidUtils.test(etag.tid) || !/^(?:[0-9]+)$/.test(etag.rev)) {
            throw new HTTPError({
                status: 400,
                body: {
                    type: 'bad_request',
                    title: 'Bad ETag in If-Match',
                    description: 'The supplied base_etag is invalid'
                }
            });
        } else {
            return uuidUtils.getDate(etag.tid).toISOString();
        }
    }

    _getBaseRevision(req) {
        if (!req.body.base_etag) {
            return;
        }
        const etag = mwUtil.parseETag(req.body.base_etag);
        if (etag) {
            return etag.rev;
        } else {
            throw new HTTPError({
                status: 400,
                body: {
                    type: 'bad_request',
                    title: 'Bad base_etag',
                    description: 'The supplied base_etag is invalid'
                }
            });
        }
    }

    _getRevInfo(hyper, req, revision) {
        const rp = req.params;
        const path = [rp.domain, 'sys', 'page_revisions', 'page', rp.title];
        if (!/^(?:[0-9]+)$/.test(revision)) {
            throw new HTTPError({
                status: 400,
                body: {
                    type: 'bad_request',
                    title: 'Bad revision',
                    description: 'The supplied revision ID is invalid'
                }
            });
        }
        path.push(revision);
        return hyper.get({ uri: new URI(path) })
        .then((res) => res.body.items[0])
        // We are dealing with a restricted revision
        // however, let MW deal with it as the user
        // might have sufficient permissions to do an edit
        .catch({ status: 403 }, () => ({ title: rp.title }));
    }

    _checkParams(params) {
        if (!(params && params.csrf_token &&
                ((params.wikitext && params.wikitext.trim()) ||
                (params.html && params.html.trim())))) {
            throw new HTTPError({
                status: 400,
                body: {
                    type: 'bad_request',
                    title: 'Missing parameters',
                    description: 'The html/wikitext and csrf_token parameters are required'
                }
            });
        }
    }
}

module.exports = () => {
    const ps = new PageSave();
    return {
        spec: {
            paths: {
                '/wikitext/{title}': {
                    post: {
                        operationId: 'saveWikitext'
                    }
                },
                '/html/{title}': {
                    post: {
                        operationId: 'saveHTML'
                    }
                }
            }
        },
        operations: {
            saveWikitext: ps.saveWikitext.bind(ps),
            saveHTML: ps.saveHtml.bind(ps)
        }
    };
};
