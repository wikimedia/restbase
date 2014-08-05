"use strict";
/*
### Alternative version with ES6 promises, but without generators

- Disadvantage: slightly uglier & more verbose than generators.
- Advantage: Compatible with node 0.10 using for example es6-shim. Native
  promise implementation is in Node 0.11+.
- Can be optimized in node 0.11, while generators can't yet
*/

// Simple request handler
function handleGet (env, req) {
    // Try the backend first
    var p = req.params;
    var backendURL = '/v1/' + p.domain + '/pages.html/' + p.title;
    req.uri = backendURL;
    if (p.revision !== undefined) {
        req.uri += '/' + p.revision;
    }
    //console.log(req.uri);
    return env.GET(req)
    .then(function(beResp) {
        if (beResp.status === 200) {
            return beResp;
        } else if (beResp.status === 404) {
            // Try to generate HTML on the fly by calling Parsoid
            var prefix = {
                'en.wikipedia.org': 'enwiki',
                'de.wikipedia.org': 'dewiki',
                'es.wikipedia.org': 'eswiki'
            }[p.domain];
            var parsoidURL = 'http://parsoid-lb.eqiad.wikimedia.org/' + prefix + '/' + p.title;
            if (p.revision) {
                // XXX: validate
                url += '?oldid=' + p.revision;
            }
            return env.GET({ uri: parsoidURL })
            .then(function(parsoidResp) {
                // handle the response from Parsoid
                console.log(parsoidResp.status, parsoidResp.headers);
                if (parsoidResp.status === 200) {
                    console.log('PUT', backendURL);
                    // Asynchronously save back the HTML
                    env.PUT({
                        uri: backendURL,
                        headers: parsoidResp.headers,
                        body: parsoidResp.body
                    });
                }
                // And return the response to the client
                return parsoidResp;
            })
            .catch(function(err) {
                console.error(err.stack);
            });
        }
    });
}

function listPages (env, req) {
    req.uri = req.uri.replace(/\/$/, '') + '.html/';
    return env.GET(req);
}

// Register handler for end point
module.exports = {
    routes: [
        {
            // TODO:
            // - generalize for other content types
            // - redirect /{title}/html to /{title}/html/{revision} (?)
            // - redirect /{title} to /{title}/html/{revision}
            // - support MediaWiki oldids
            path: '/v1/{domain}/pages/{title}/html{/revision}',
            methods: {
                GET: {
                    handler: handleGet,
                    doc: { /* swagger docs */
                        "summary": "Retrieves the HTML of a specific revision",
                        "notes": "Returns HTML+RDFa.",
                        "type": "html",
                        "produces": ["text/html;spec=mediawiki.org/specs/html/1.0"],
                        "responseMessages": [
                            {
                                "code": 404,
                                "message": "No HTML for page & revision found"
                            }
                        ]
                    }
                }
            }
        },
        {
            path: '/v1/{domain}/pages/',
            methods: {
                GET: {
                    handler: listPages,
                    doc: { /* swagger docs */
                        "summary": "List all pages",
                    }
                }
            }
        },
        {
            path: '/v1/{domain}/pages/{title}',
            methods: {
                GET: {
                    handler: function (env, req) {
                        return {
                            status: 302,
                            headers: {
                                location: req.uri + '/html'
                            }
                        };
                    },
                    doc: { /* swagger docs */
                        "summary": "Redirect to HTML by default.",
                    }
                }
            }
        },
        {
            path: '/v1/{domain}/pages/{title}/',
            methods: {
                GET: {
                    handler: function (env, req) {
                        return {
                            status: 200,
                            headers: {
                                'content-type': 'application/json'
                            },
                            body: ['html', 'wikitext', 'data-mw', 'data-parsoid']
                        };
                    },
                    doc: { /* swagger docs */
                        "summary": "List the publicly accessible content types.",
                    }
                }
            }
        }
    ]
};
