'use strict';

/*
 * Simple wrapper for the PHP action API
 */

module.exports = {
    paths: {
        '/v1/{domain}/action/query': {
            all: {
                request_handler: function(restbase, req) {
                    var rp = req.params;
                    req.uri = 'http://' + rp.domain + '/w/api.php';
                    req.body.action = 'query';
                    // Always request json
                    req.body.format = 'json';
                    return restbase.post(req)
                    .then(function(res) {
                        if (res.status !== 200) {
                            return res;
                        }
                        // Rewrite res.body
                        var pages = res.body.query.pages;
                        var newBody = [];
                        Object.keys(pages).forEach(function(key) {
                            newBody.push(pages[key]);
                        });
                        res.body = newBody;
                        return res;
                    });
                }
            }
        }
    }
};
