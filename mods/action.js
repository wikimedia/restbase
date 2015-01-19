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

function buildResponse(res) {
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

ActionService.prototype.query = function(restbase, req) {
    var rp = req.params;
    req.uri = this.apiURI(rp.domain);
    var body = req.body;
    body.action = 'query';
    // Always request json
    body.format = 'json';
    req.method = 'post';
    return restbase[req.method](req).then(buildResponse);
};

module.exports = function (options) {
    var actionService = new ActionService(options);
    return {
        spec: {
            paths: {
                '/query': {
                    all: {
                        operationId: 'query'
                    }
                }
            }
        },
        operations: {
            query: actionService.query.bind(actionService)
        }
    };
};
