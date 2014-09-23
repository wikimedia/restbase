"use strict";

// General https? backend
var request = require('request');

function request_p (req) {
    return new Promise(function(resolve, reject) {
        function cb (error, resp, body) {
            if (error) {
                reject(error);
                return;
            } else {
                var res = {
                    status: resp.statusCode,
                    headers: resp.headers,
                    body: resp.body
                };
                resolve(res);
            }
        }

        request(req, cb);
    });
}

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
            if (/^application\/json/.test(req.headers['content-type'])) {
                beReq.body = JSON.stringify(req.body);
            } else {
                beReq.form = req.body;
            }
        } else {
            beReq.body = req.body;
        }
    }
    return request_p(beReq);
}

// Register handler for end point
module.exports = {
    paths: {
        're:/^((?:https?:)?\/\/).+/': {
            all: {
                summary: "Generic HTTPS? backend handler",
                request_handler: handleAll
            }
        }
    }
};
