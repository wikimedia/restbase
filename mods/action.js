'use strict';

/*
 * Simple wrapper for the PHP action API
 */

var rbUtil = require('../lib/rbUtil');

function ActionService (options) {
    this.apiURITemplate = options.apiURI;
}

ActionService.prototype.apiURI = function(domain) {
    // TODO: use proper templating
    return this.apiURITemplate.replace(/\{domain\}/, domain);
};

function apiError(apiErr) {
    var ret;
    apiErr = apiErr || {};
    ret = {
        status: 500,
        body: {
            type: 'server_error',
            title: apiErr.code || 'MW API Error',
            description: apiErr.info || 'Unknown MW API error'
        }
    };
    if(!apiErr.code) {
        return new rbUtil.HTTPError(ret);
    }
    switch(apiErr.code) {
        /* 400 - bad request */
        case 'articleexists':
        case 'badformat':
        case 'badmd5':
        case 'badtoken':
        case 'invalidparammix':
        case 'invalidsection':
        case 'invalidtitle':
        case 'invaliduser':
        case 'missingparam':
        case 'missingtitle':
        case 'nosuchpageid':
        case 'nosuchrcid':
        case 'nosuchrevid':
        case 'nosuchsection':
        case 'nosuchuser':
        case 'notext':
        case 'notitle':
        case 'pagecannotexist':
        case 'revwrongpage':
            ret.status = 400;
            ret.body.type = 'invalid_request';
            break;
        /* 401 - unauthorised */
        case 'cantcreate-anon':
        case 'confirmemail':
        case 'noedit-anon':
        case 'noimageredirect-anon':
        case 'protectedpage':
        case 'readapidenied':
            ret.status = 401;
            ret.body.type = 'unauthorized';
            break;
        /* 403 - access denied */
        case 'autoblocked':
        case 'blocked':
        case 'cantcreate':
        case 'customcssjsprotected':
        case 'customcssprotected':
        case 'customjsprotected':
        case 'emptynewsection':
        case 'emptypage':
        case 'noedit':
        case 'noimageredirect':
        case 'permissiondenied':
        case 'protectednamespace':
        case 'protectednamespace-interface':
        case 'protectedtitle':
        case 'readonly':
        case 'writeapidenied':
            ret.status = 403;
            ret.body.type = 'access_denied#edit';
            break;
        /* 409 - conflict */
        case 'cascadeprotected':
        case 'editconflict':
        case 'pagedeleted':
        case 'spamdetected':
            ret.status = 409;
            ret.body.type = 'conflict';
            break;
        /* 412 - precondition failed */
        case 'filtered':
        case 'hookaborted':
        case 'unsupportednamespace':
            ret.status = 412;
            ret.body.type = 'precondition_fail';
            break;
        /* 413 - body too large */
        case 'contenttoobig':
            ret.status = 413;
            ret.body.type = 'too_large';
            break;
        /* 429 - rate limit exceeded */
        case 'ratelimited':
            ret.status = 429;
            ret.body.type = 'rate_exceeded';
            break;
        /* 501 - not supported */
        case 'editnotsupported':
            ret.status = 501;
            ret.body.type = 'not_supported';
            break;
    }
    return new rbUtil.HTTPError(ret);
}

function buildQueryResponse(res) {
    if (res.status !== 200) {
        throw apiError({info: 'Unexpected response status (' + res.status + ') from the PHP action API.'});
    } else if(!res.body || res.body.error) {
        throw apiError((res.body || {}).error);
    } else if (!res.body.query || !res.body.query.pages) {
        throw apiError({info: 'Missing query pages from the PHP action API response.'});
    }
    // Rewrite res.body
    // XXX: Rethink!
    var pages = res.body.query.pages;
    var newBody = Object.keys(pages).map(function(key) {
        return pages[key];
    });
    // XXX: Clean this up!
    res.body = {
        items: newBody,
        next: res.body["query-continue"]
    };
    return res;
}

function buildEditResponse(res) {
    if (res.status !== 200) {
        throw apiError({info: 'Unexpected response status (' + res.status + ') from the PHP action API.'});
    } else if (!res.body || res.body.error) {
        throw apiError((res.body || {}).error);
    }
    res.body = res.body.edit;
    return res;
}

ActionService.prototype._doRequest = function(restbase, req, defBody, cont) {
    var rp = req.params;
    req.uri = this.apiURI(rp.domain);
    var body = req.body;
    body.action = defBody.action;
    body.format = body.format || defBody.format || 'json';
    body.formatversion = body.formatversion || defBody.formatversion || 1;
    req.method = 'post';
    return restbase[req.method](req).then(cont);
};

ActionService.prototype.query = function(restbase, req) {
    return this._doRequest(restbase, req, {
        action: 'query',
        format: 'json'
    }, buildQueryResponse);
};

ActionService.prototype.edit = function(restbase, req) {
    return this._doRequest(restbase, req, {
        action: 'edit',
        format: 'json',
        formatversion: 2
    }, buildEditResponse);
};


module.exports = function (options) {
    var actionService = new ActionService(options);
    return {
        spec: {
            paths: {
                '/query': {
                    all: {
                        operationId: 'mwApiQuery'
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
            mwApiEdit: actionService.edit.bind(actionService)
        }
    };
};
