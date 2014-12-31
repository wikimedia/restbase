"use strict";

// General https? backend
var preq = require('preq');

function handleAll (restbase, req) {

    // some tests use a fake en.wikipedia.test.local domain, which will confuse
    // external  services such as parsoid and api.php -- if found here, replace 
    // with en.wikipedia.org
    req.uri = req.uri.replace(/\/en.wikipedia.test.local\//, '/en.wikipedia.org/');

    if (restbase._options.conf.offline) {
        throw new Error("We are offline, you are tring to fallback to dynamic api");
    }

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
