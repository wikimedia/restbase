'use strict';

/*
 * Simple wrapper for the PHP action API
 */

const HyperSwitch = require('hyperswitch');
const HTTPError = HyperSwitch.HTTPError;
const Template = HyperSwitch.Template;

/**
 * Error translation
 */
const errDefs = {
    400: { status: 400, type: 'bad_request' },
    401: { status: 401, type: 'unauthorized' },
    403: { status: 403, type: 'forbidden#edit' },
    409: { status: 409, type: 'conflict' },
    413: { status: 413, type: 'too_large' },
    429: { status: 429, type: 'rate_exceeded' },
    500: { status: 500, type: 'server_error' },
    501: { status: 501, type: 'not_supported' }
};

const errCodes = {
    /* 400 - bad request */
    articleexists: errDefs['400'],
    badformat: errDefs['400'],
    badmd5: errDefs['400'],
    badtoken: errDefs['400'],
    invalidparammix: errDefs['400'],
    invalidsection: errDefs['400'],
    invalidtitle: errDefs['400'],
    invaliduser: errDefs['400'],
    missingparam: errDefs['400'],
    missingtitle: errDefs['400'],
    nosuchpageid: errDefs['400'],
    nosuchrcid: errDefs['400'],
    nosuchrevid: errDefs['400'],
    nosuchsection: errDefs['400'],
    nosuchuser: errDefs['400'],
    notext: errDefs['400'],
    notitle: errDefs['400'],
    pagecannotexist: errDefs['400'],
    'readinglists-db-error-not-set-up': errDefs['400'],
    'readinglists-db-error-already-set-up': errDefs['400'],
    'readinglists-db-error-cannot-delete-default-list': errDefs['400'],
    'readinglists-db-error-cannot-update-default-list': errDefs['400'],
    'readinglists-db-error-no-such-list': errDefs['400'],
    'readinglists-db-error-no-such-list-entry': errDefs['400'],
    'readinglists-db-error-not-own-list': errDefs['400'],
    'readinglists-db-error-not-own-list-entry': errDefs['400'],
    'readinglists-db-error-list-deleted': errDefs['400'],
    'readinglists-db-error-list-entry-deleted': errDefs['400'],
    'readinglists-db-error-duplicate-page': errDefs['400'],
    'readinglists-db-error-empty-list-ids': errDefs['400'],
    'readinglists-db-error-user-required': errDefs['400'],
    'readinglists-db-error-list-limit': errDefs['400'],
    'readinglists-db-error-entry-limit': errDefs['400'],
    'readinglists-db-error-too-long': errDefs['400'],
    'readinglists-db-error-no-such-project': errDefs['400'],
    'readinglists-project-title-param': errDefs['400'],
    'readinglists-too-old': errDefs['400'],
    'readinglists-invalidsort-notbyname': errDefs['400'],
    'readinglists-batch-invalid-json': errDefs['400'],
    'readinglists-batch-invalid-structure': errDefs['400'],
    'readinglists-batch-toomanyvalues': errDefs['400'],
    'readinglists-batch-missingparam-at-least-one-of': errDefs['400'],
    revwrongpage: errDefs['400'],

    /* 401 - unauthorised */
    'cantcreate-anon': errDefs['401'],
    confirmemail: errDefs['401'],
    'noedit-anon': errDefs['401'],
    'noimageredirect-anon': errDefs['401'],
    notloggedin: errDefs['401'],
    protectedpage: errDefs['401'],
    readapidenied: errDefs['401'],
    /* 403 - access denied */
    autoblocked: errDefs['403'],
    blocked: errDefs['403'],
    cantcreate: errDefs['403'],
    customcssjsprotected: errDefs['403'],
    customcssprotected: errDefs['403'],
    customjsprotected: errDefs['403'],
    emptynewsection: errDefs['403'],
    emptypage: errDefs['403'],
    filtered: errDefs['403'],
    hookaborted: errDefs['403'],
    noedit: errDefs['403'],
    noimageredirect: errDefs['403'],
    permissiondenied: errDefs['403'],
    protectednamespace: errDefs['403'],
    'protectednamespace-interface': errDefs['403'],
    protectedtitle: errDefs['403'],
    readonly: errDefs['403'],
    unsupportednamespace: errDefs['403'],
    writeapidenied: errDefs['403'],
    /* 409 - conflict */
    cascadeprotected: errDefs['409'],
    editconflict: errDefs['409'],
    pagedeleted: errDefs['409'],
    spamdetected: errDefs['409'],
    /* 413 - body too large */
    contenttoobig: errDefs['413'],
    /* 429 - rate limit exceeded */
    ratelimited: errDefs['429'],
    /* 501 - not supported */
    editnotsupported: errDefs['501']
};

function apiError(apiErr) {
    apiErr = apiErr || {};
    const  ret = {
        msg: `MW API call error ${apiErr.code}`,
        status: errDefs['500'].status,
        body: {
            type: errDefs['500'].type,
            title: apiErr.code || 'MW API Error',
            description: apiErr.info || 'Unknown MW API error'
        }
    };
    if (apiErr.code && {}.hasOwnProperty.call(errCodes, apiErr.code)) {
        ret.status = errCodes[apiErr.code].status;
        ret.body.type = errCodes[apiErr.code].type;
    }
    return new HTTPError(ret);
}

function checkQueryResponse(apiReq, res) {
    if (res.status !== 200) {
        throw apiError({
            info: `Unexpected response status (${res.status}) from the PHP action API.`
        });
    } else if (!res.body || res.body.error) {
        throw apiError((res.body || {}).error);
    }
    return res;
}

function buildQueryResponse(apiReq, res) {
    checkQueryResponse(apiReq, res);
    if (!res.body.query || (!res.body.query.pages && !res.body.query.userinfo)) {
        throw new HTTPError({
            status: 404,
            body: {
                type: 'not_found',
                description: 'Requested resource is not found.',
                apiRequest: apiReq
            }
        });
    }

    if (res.body.query.pages) {
        // Rewrite res.body
        // XXX: Rethink!
        const pages = res.body.query.pages;
        const newBody = Object.keys(pages).map(key => pages[key]);

        // XXX: Clean this up!
        res.body = {
            items: newBody,
            next: res.body.continue
        };
        return res;
    } else if (res.body.query.userinfo) {
        res.body = res.body.query.userinfo;
        return res;
    } else {
        throw apiError({ info: 'Unable to parse PHP action API response.' });
    }
}

function buildEditResponse(apiReq, res) {
    if (res.status !== 200) {
        throw apiError({
            info: `Unexpected response status (${res.status}) from the PHP action API.`
        });
    } else if (!res.body || res.body.error) {
        throw apiError((res.body || {}).error);
    }
    res.body = res.body.edit;
    if (res.body && !res.body.nochange) {
        res.status = 201;
    }
    return res;
}

function findSharedRepoDomain(siteInfoRes) {
    const sharedRepo = (siteInfoRes.body.query.repos || []).find(repo => repo.name === 'shared');
    if (sharedRepo) {
        const domainMatch = /^((:?https?:)?\/\/[^/]+)/.exec(sharedRepo.descBaseUrl);
        if (domainMatch) {
            return domainMatch[0];
        }
    }
}

function logError(hyper, err) {
    if (err.status >= 400 && err.status !== 404 && err.status < 500) {
        hyper.log('debug/api_error', err);
    }
}

/**
 * Action module code
 */
class ActionService {
    constructor(options) {
        if (!options) { throw new Error("No options supplied for action module"); }
        if (!options.apiUriTemplate || !options.baseUriTemplate) {
            const e = new Error('Missing parameter in action module:\n'
                    + '- baseUriTemplate string parameter, or\n'
                    + '- apiUriTemplate string parameter.');
            e.options = options;
            throw e;
        }

        this.apiRequestTemplate = new Template({
            uri: options.apiUriTemplate,
            method: 'post',
            headers: {
                host: '{{request.params.domain}}'
            },
            body: '{{request.body}}',
        });
        this.baseUriTemplate = new Template({
            uri: options.baseUriTemplate
        });

        this._siteInfoCache = {};
    }

    _doRequest(hyper, req, defBody, cont) {
        const apiRequest = this.apiRequestTemplate.expand({
            request: req
        });
        apiRequest.body = apiRequest.body || {};
        apiRequest.body.action = apiRequest.body.action || defBody.action;
        apiRequest.body.format = apiRequest.body.format || defBody.format || 'json';
        apiRequest.body.formatversion = apiRequest.body.formatversion || defBody.formatversion || 1;
        apiRequest.body.meta = apiRequest.body.meta || defBody.meta;
        if (!{}.hasOwnProperty.call(apiRequest.body, 'continue') && apiRequest.action === 'query') {
            apiRequest.body.continue = '';
        }
        return hyper.request(apiRequest)
        .then(cont.bind(null, apiRequest));
    }

    _getBaseUri(req) {
        return this.baseUriTemplate.expand({ request: req }).uri;
    }

    query(hyper, req) {
        return this._doRequest(hyper, req, {
            action: 'query',
            format: 'json'
        }, buildQueryResponse)
        .tapCatch(logError.bind(null, hyper));
    }

    rawQuery(hyper, req) {
        return this._doRequest(hyper, req, {
            format: 'json',
            formatversion: 2
        }, checkQueryResponse)
        .tapCatch(logError.bind(null, hyper));
    }

    edit(hyper, req) {
        return this._doRequest(hyper, req, {
            action: 'edit',
            format: 'json',
            formatversion: 2
        }, buildEditResponse)
        .tapCatch(logError.bind(null, hyper));
    }

    /**
     * Fetch the site info for this project's domain.
     *
     * Expects the project domain to be passed in req.params.domain. Fetching
     * siteinfo for other projects / domains is not supported.
     */
    siteinfo(hyper, req) {
        const rp = req.params;
        if (!this._siteInfoCache[rp.domain]) {
            this._siteInfoCache[rp.domain] = this._doRequest(hyper, {
                method: 'post',
                params: req.params,
                headers: req.headers,
                body: {
                    action: 'query',
                    meta: 'siteinfo|filerepoinfo',
                    siprop: 'general|namespaces|namespacealiases|specialpagealiases',
                    format: 'json'
                }
            }, {}, (apiReq, res) => {
                if (!res || !res.body || !res.body.query || !res.body.query.general) {
                    throw new Error(`SiteInfo is unavailable for ${rp.domain}`);
                }
                return {
                    status: 200,
                    body: {
                        general: {
                            lang: res.body.query.general.lang,
                            legaltitlechars: res.body.query.general.legaltitlechars,
                            case: res.body.query.general.case
                        },

                        namespaces: res.body.query.namespaces,
                        namespacealiases: res.body.query.namespacealiases,
                        specialpagealiases: res.body.query.specialpagealiases,
                        sharedRepoRootURI: findSharedRepoDomain(res),
                        baseUri: this._getBaseUri(req)
                    }
                };
            })
            .catch((e) => {
                hyper.log('error/site_info', e);
                delete this._siteInfoCache[rp.domain];
                // The project domain is always expected to exist, so consider
                // any error an internal error.
                throw new HTTPError({
                    status: 500,
                    body: {
                        type: 'server_error',
                        title: 'Site info fetch failed.',
                        detail: e.message
                    }
                });
            });
        }
        return this._siteInfoCache[rp.domain];
    }
}

module.exports = (options) => {
    const actionService = new ActionService(options);
    return {
        spec: {
            paths: {
                '/query': {
                    all: {
                        operationId: 'mwApiQuery'
                    }
                },
                '/rawquery': {
                    all: {
                        operationId: 'mwRawApiQuery'
                    }
                },
                '/siteinfo': {
                    all: {
                        operationId: 'mwApiSiteInfo'
                    }
                },
                '/edit': {
                    post: {
                        operationId: 'mwApiEdit'
                    }
                }
            }
        },
        operations: {
            mwApiQuery: actionService.query.bind(actionService),
            mwRawApiQuery: actionService.rawQuery.bind(actionService),
            mwApiEdit: actionService.edit.bind(actionService),
            mwApiSiteInfo: actionService.siteinfo.bind(actionService)
        }
    };
};
