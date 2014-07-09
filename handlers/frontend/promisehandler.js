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
    return env.GET(req)
    .then(function(beResp) {
        if (beResp.status === 200) {
            return beResp;
        } else if (beResp.status === 404) {
            // Try to generate HTML on the fly by calling Parsoid
            return env.GET('/v1/_parsoid/' + env.account + env.req.uri)
            .then(function(parsoidResp) {
                // handle the response from Parsoid
                if (parsoidResp.status === 200) {
                    // Asynchronously save back the HTML
                    env.PUT({
                        uri: req.uri,
                        headers: parsoidResp.headers,
                        body: parsoidResp.body
                    });
                }
                // And return the response to the client
                return parsoidResp;
            });
        }
    });
}

// Register handler for end point
module.exports = {
    routes: [
        {
            path: '/v1/{account}/pages/{title}/rev/{rev}/html',
            methods: {
                get: {
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
        }
    ]
};
