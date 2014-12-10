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

                    // TODO: this is a hack to allow us to test with a safe/fake
                    // domain, but still call out to a real service
                    var domain = rp.domain;
                    if (domain === 'en.wikipedia.test.local') {
                        domain = 'en.wikipedia.org';
                    }

                    req.uri = 'http://' + domain + '/w/api.php';
                    var body = req.body || req.query;
                    body.action = 'query';
                    // Always request json
                    body.format = 'json';
                    return restbase[req.method](req)
                    .then(function(res) {
                        if (res.status !== 200) {
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
