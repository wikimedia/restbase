"use strict";

// General https? backend
var preq = require('preq');

function handleAll (restbase, req) {
    //yield requestPr(req);
    var beReq = {
        method: req.method,
        uri: req.uri,
        headers: req.headers,
        qs: req.query
    };
    if (req.body) {
        if (req.body.constructor === Object) {
            if (req.headers
                    && /^application\/json/.test(req.headers['content-type']))
            {
                beReq.body = JSON.stringify(req.body);
            } else {
                beReq.form = req.body;
            }
        } else {
            beReq.body = req.body;
        }
    }
    return preq(beReq);
}

// Register handler for end point
module.exports = {
    paths: {
        're:/^((?:https?:)?\\/\\/).+/': {
            all: {
                summary: "Generic HTTPS? backend handler",
                request_handler: handleAll
            }
        }
    }
};
