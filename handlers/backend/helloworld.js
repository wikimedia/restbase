"use strict";
/*
 * env.{GET,PUT,..} provides a virtual REST service by mapping paths to
 * backend requests. Returns promises.
 */
function handleAll (env, req) {
    //yield requestPr(req);
    return Promise.resolve({
        body: 'Hello World!',
        status: 200
    });
}

// Register handler for end point
module.exports = {
    routes: [
        {
            path: '/v1/helloworld',
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
