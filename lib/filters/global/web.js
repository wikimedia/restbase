"use strict";

// General https? backend
var preq = require('preq');
var tools = require('../../tools');

function handleAll (restbase, req) {

    // some tests use a fake en.wikipedia.test.local domain, which will confuse
    // external  services such as parsoid and api.php -- if found here, replace
    // with en.wikipedia.org
    req.uri = req.uri
        .replace(/^http:\/\/en\.wikipedia\.test\.local\//,
                 'http://en.wikipedia.org/')
        .replace(/^http:\/\/parsoid-lb\.eqiad\.wikimedia\.org\/v2\/en\.wikipedia\.test\.local\//,
                 'http://parsoid-lb.eqiad.wikimedia.org/v2/en.wikipedia.org/')
        .replace(/\/v1\/en\.wikipedia\.test\.local\//,
                 '/v1/en.wikipedia.org/')
        .replace(/\/v2\/en\.wikipedia\.test\.local\//,
                 '/v2/en.wikipedia.org/');

    if (restbase._options.conf.offline) {
        return Promise.resolve({
            status: 500,
            body: {
                error: 'We are offline, but your request needs to be serviced online.'
            }
        });
    }

    var headers = req.headers;
    if (headers) {
        headers = tools.filterOutKeys(headers, ['host']);
    }
    //yield requestPr(req);
    var beReq = {
        method: req.method,
        uri: req.uri,
        headers: headers,
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
