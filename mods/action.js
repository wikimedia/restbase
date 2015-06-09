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

function buildQueryResponse(res) {
    if (res.status !== 200) {
        throw rbUtil.httpErrors.server('Unexpected response status (' + res.status + ') from the PHP action API.');
    } else if (!res.body || !res.body.query || !res.body.query.pages) {
        throw rbUtil.httpErrors.server('Missing query pages from the PHP action API response.');
    } else {
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
}

function buildEditResponse(res) {
    if (res.status !== 200) {
        throw rbUtil.httpErrors.server('Unexpected response status (' + res.status + ') from the PHP action API.');
    } else if (!res.body || res.body.error) {
        throw rbUtil.httpErrors.server('Bad return');
    }
    res.body = undefined;
    res.status = 201;
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
}

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
