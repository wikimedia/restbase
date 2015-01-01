'use strict';

/*
 * Simple wrapper for the PHP action API
 */

module.exports = {
    paths: {
        '/v1/{domain}/_svc/action/query': {
            all: {
                request_handler: function(restbase, req) {
                    var rp = req.params;
                    req.uri = 'http://' + rp.domain + '/w/api.php';
                    var body = req.body || req.query;
                    body.action = 'query';
                    // Always request json
                    body.format = 'json';
                    return restbase[req.method](req)
                    .then(function(res) {
                        if (
                            res.status !== 200
                            || !res.body
                            || !res.body.query
                            || !res.body.query.pages
                        ) {
                            return res;
                        }
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
                    });
                }
            }
        }
    }
};
