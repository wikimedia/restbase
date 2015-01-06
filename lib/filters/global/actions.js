'use strict';

/*
 * Simple wrapper for the PHP action API
 */

var rbUtil = require('../../rbUtil');

function buildResponse(res) {
    if (res.status !== 200) {
        throw rbUtil.httpErrors.server('Unexpected response status (' + res.status + ') from the PHP action API.');
    } else if (!res.body || !res.body.query || !res.body.query.pages) {
        throw rbUtil.httpErrors.server('Missing query pages from the PHP action API response.');
    } else {
        // Rewrite res.body
        // XXX: Rethink!
        var pages = res.body.query.pages;
        var newBody = [];
        Object.keys(pages).forEach(function(key) {
            newBody.push(pages[key]);
        });
        // XXX: Clean this up!
        res.body = {
            items: newBody,
            next: res.body["query-continue"]
        };
        return res;
    }
}

function query(restbase, req) {
    var rp = req.params;
    req.uri = 'http://' + rp.domain + '/w/api.php';
    var body = req.body || req.query;
    body.action = 'query';
    // Always request json
    body.format = 'json';
    return restbase[req.method](req).then(buildResponse);
}

module.exports = {
    paths: {
        '/v1/{domain}/_svc/action/query': {
            all: {
                request_handler: query
            }
        }
    }
};
