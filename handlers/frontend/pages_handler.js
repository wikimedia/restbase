"use strict";

// Special properties set up & managed by this page handler
// Other properties can be handled by separate handlers with a higher prio or
// fall through to backend:
// PUT ../pages.someprop -- create a new bucket
// PUT ../pages/{name}/someprop -- add an entry to that bucket
var pageProps = ['html', 'wikitext', 'data-mw', 'data-parsoid', 'mwrev'];
var pagePropSet = {};
pageProps.forEach(function(prop) {
    pagePropSet[prop] = true;
});

// Simple Parsoid request handler
function handleItem (env, req) {
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

// FIXME: Only list pages with current versions
function listPages (env, req) {
    req.uri = req.uri.replace(/\/$/, '') + '.html/';
    return env.GET(req);
}

// Register handler for end point
module.exports = {
    paths: {
        '/v1/{domain}/pages/': {
            get: {
                summary: "List all pages",

                request_handler: listPages
            }
        },
        '/v1/{domain}/pages/{title}': {
            get: {
                summary: "Redirect to HTML by default.",
                request_handler: function (env, req) {
                    return {
                        status: 302,
                        headers: {
                            location: req.uri + '/html'
                        }
                    };
                }
            }
        },
        '/v1/{domain}/pages/{title}/': {
            get: {
                summary: "List the publicly accessible content types.",

                request_handler: function (env, req) {
                    return {
                        status: 200,
                        headers: {
                            'content-type': 'application/json'
                        },
                        body: ['html', 'wikitext', 'data-mw', 'data-parsoid']
                    };
                }
            }
        },
        '/v1/{domain}/pages/{title}/html{/revision}': {
            // TODO:
            // - generalize for other content types
            // - redirect /{title}/html to /{title}/html/{revision} (?)
            // - redirect /{title} to /{title}/html/{revision}
            // - support MediaWiki oldids
            put: {
                handler: function (env, req) {
                    var p = req.params;
                    var backendURL = '/v1/' + p.domain + '/pages.html/' + p.title;
                    if (p.revision) {
                        backendURL += '/' + p.revision;
                    }
                    req.uri = backendURL;
                    return env.PUT(req);
                }
            },
            get: {
                summary: "Retrieves the HTML of a specific revision",
                notes: "Returns HTML+RDFa.",
                type: "html",
                produces: ["text/html;spec=mediawiki.org/specs/html/1.0"],

                handler: handleItem,
            }
        }
    }
};
