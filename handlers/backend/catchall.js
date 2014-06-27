"use strict";

// Run with 'node --harmony' using node 0.11+

var prfun = require('prfun'),
    request = require('request'),
    requestPr = Promise.promisify(request);

/*
 * env.{GET,PUT,..} provides a virtual REST service by mapping paths to
 * backend requests. Returns promises.
 */
function* handleAll (env, req) {
    console.log('backend handleall');
    //yield requestPr(req);
    return {
        body: 'mock body!',
        status: 200,
        headers: {}
    };
}

// Register handler for end point
module.exports = {
    routes: [
        {
            path: /^\/v1\/.*$/,
            methods: {
                all: {
                    handler: handleAll,
                    doc: { /* swagger docs */
                        "summary": "Mock fall-back handler"
                    }
                }
            }
        }
    ]
};
