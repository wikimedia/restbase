'use strict';

/*
 * Simple wrapper for the PHP action API
 */

var rbUtil = require('../lib/rbUtil');

/**
 * Error translation
 */
var errDefs = {
    '400': { status: 400, type: 'invalid_request' },
    '401': { status: 401, type: 'unauthorized' },
    '403': { status: 403, type: 'access_denied#edit' },
    '409': { status: 409, type: 'conflict' },
    '413': { status: 413, type: 'too_large' },
    '429': { status: 429, type: 'rate_exceeded' },
    '500': { status: 500, type: 'server_error' },
    '501': { status: 501, type: 'not_supported' }
};

var errCodes = {
    /* 400 - bad request */
    'articleexists': errDefs['400'],
    'badformat': errDefs['400'],
    'badmd5': errDefs['400'],
    'badtoken': errDefs['400'],
    'invalidparammix': errDefs['400'],
    'invalidsection': errDefs['400'],
    'invalidtitle': errDefs['400'],
    'invaliduser': errDefs['400'],
    'missingparam': errDefs['400'],
    'missingtitle': errDefs['400'],
    'nosuchpageid': errDefs['400'],
    'nosuchrcid': errDefs['400'],
    'nosuchrevid': errDefs['400'],
    'nosuchsection': errDefs['400'],
    'nosuchuser': errDefs['400'],
    'notext': errDefs['400'],
    'notitle': errDefs['400'],
    'pagecannotexist': errDefs['400'],
    'revwrongpage': errDefs['400'],
    /* 401 - unauthorised */
    'cantcreate-anon': errDefs['401'],
    'confirmemail': errDefs['401'],
    'noedit-anon': errDefs['401'],
    'noimageredirect-anon': errDefs['401'],
    'protectedpage': errDefs['401'],
    'readapidenied': errDefs['401'],
    /* 403 - access denied */
    'autoblocked': errDefs['403'],
    'blocked': errDefs['403'],
    'cantcreate': errDefs['403'],
    'customcssjsprotected': errDefs['403'],
    'customcssprotected': errDefs['403'],
    'customjsprotected': errDefs['403'],
    'emptynewsection': errDefs['403'],
    'emptypage': errDefs['403'],
    'filtered': errDefs['403'],
    'hookaborted': errDefs['403'],
    'noedit': errDefs['403'],
    'noimageredirect': errDefs['403'],
    'permissiondenied': errDefs['403'],
    'protectednamespace': errDefs['403'],
    'protectednamespace-interface': errDefs['403'],
    'protectedtitle': errDefs['403'],
    'readonly': errDefs['403'],
    'unsupportednamespace': errDefs['403'],
    'writeapidenied': errDefs['403'],
    /* 409 - conflict */
    'cascadeprotected': errDefs['409'],
    'editconflict': errDefs['409'],
    'pagedeleted': errDefs['409'],
    'spamdetected': errDefs['409'],
    /* 413 - body too large */
    'contenttoobig': errDefs['413'],
    /* 429 - rate limit exceeded */
    'ratelimited': errDefs['429'],
    /* 501 - not supported */
    'editnotsupported': errDefs['501']
};

function apiError(apiErr) {
    var ret;
    apiErr = apiErr || {};
    ret = {
        message: 'MW API call error ' + apiErr.code,
        status: errDefs['500'].status,
        body: {
            type: errDefs['500'].type,
            title: apiErr.code || 'MW API Error',
            description: apiErr.info || 'Unknown MW API error'
        }
    };
    if(apiErr.code && errCodes.hasOwnProperty(apiErr.code)) {
        ret.status = errCodes[apiErr.code].status;
        ret.body.type = errCodes[apiErr.code].type;
    }
    return new rbUtil.HTTPError(ret);
}


/**
 * Action module code
 */
function ActionService (options) {
    this.apiURITemplate = options.apiURI;
}

ActionService.prototype.apiURI = function(domain) {
    // TODO: use proper templating
    return this.apiURITemplate.replace(/\{domain\}/, domain);
};

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
        next: res.body["continue"]
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
    if(res.body && !res.body.nochange) {
        res.status = 201;
    }
    return res;
}

ActionService.prototype._doRequest = function(restbase, req, defBody, cont) {
    var rp = req.params;
    req.uri = this.apiURI(rp.domain);
    var body = req.body;
    body.action = defBody.action;
    body.format = body.format || defBody.format || 'json';
    body.formatversion = body.formatversion || defBody.formatversion || 1;
    if (!body.hasOwnProperty('continue')) {
        body.continue = '';
    }
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
