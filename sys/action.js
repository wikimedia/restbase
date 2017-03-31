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
    revwrongpage: errDefs['400'],
    /* 401 - unauthorised */
    'cantcreate-anon': errDefs['401'],
    confirmemail: errDefs['401'],
    'noedit-anon': errDefs['401'],
    'noimageredirect-anon': errDefs['401'],
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
        message: `MW API call error ${apiErr.code}`,
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

function buildQueryResponse(apiReq, res) {
    if (res.status !== 200) {
        throw apiError({
            info: `Unexpected response status (${res.status}) from the PHP action API.`
        });
    } else if (!res.body || res.body.error) {
        throw apiError((res.body || {}).error);
    } else if (!res.body.query || (!res.body.query.pages && !res.body.query.userinfo)) {
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
        return hyper.request(apiRequest).then(cont.bind(null, apiRequest));
    }

    _getBaseUri(req) {
        return this.baseUriTemplate.expand({ request: req }).uri;
    }

    query(hyper, req) {
        return this._doRequest(hyper, req, {
            action: 'query',
            format: 'json'
        }, buildQueryResponse);
    }

    edit(hyper, req) {
        return this._doRequest(hyper, req, {
            action: 'edit',
            format: 'json',
            formatversion: 2
        }, buildEditResponse);
    }

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
                    siprop: 'general|namespaces|namespacealiases',
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
                        sharedRepoRootURI: findSharedRepoDomain(res),
                        baseUri: this._getBaseUri(req)
                    }
                };
            })
            .catch((e) => {
                hyper.log('error/site_info', e);
                delete this._siteInfoCache[rp.domain];
                throw e;
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
            mwApiEdit: actionService.edit.bind(actionService),
            mwApiSiteInfo: actionService.siteinfo.bind(actionService)
        }
    };
};
