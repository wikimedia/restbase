"use strict";

/*
 * Simple RestFace server
 *
 * Dynamically loads & runs front & back-end handlers, and dispatches between
 * them.
 */

var fs = require('fs');
//var prfun = require('prfun');
var Verbs = require('./Verbs');
var http = require('http');
var url = require('url');
var RouteSwitch = require('routeswitch');
var Busboy = require('busboy');

    // TODO: use bunyan or the Parsoid logger backend!
var log = function (level) {
    var msg = JSON.stringify(Array.prototype.slice.call(arguments), null, 2);
    if (/^error/.test(level)) {
        console.error(msg);
    } else {
        console.log(msg);
    }
};
var app = {};

// Optimized URL parsing
var qs = require('querystring');
// Should make it into 0.12, see https://github.com/joyent/node/pull/7878
var SIMPLE_PATH = /^(\/(?!\/)[^\?#\s]*)(\?[^#\s]*)?$/;
function parseURL (uri) {
    // Fast path for simple path uris
    var fastMatch = SIMPLE_PATH.exec(uri);
    if (fastMatch) {
        return {
            protocol: null,
            slashes: null,
            auth: null,
            host: null,
            port: null,
            hostname: null,
            hash: null,
            search: fastMatch[2] || '',
            pathname: fastMatch[1],
            path: fastMatch[1],
            query: fastMatch[2] && qs.parse(fastMatch[2]) || {},
            href: uri
        };
    } else {
        return url.parse(uri, true);
    }
}

// Parse a POST request into request.body with BusBoy
// Drops file uploads on the floor without creating temporary files
//
// @param {request} HTTP request
// @returns {Promise<>}
function parsePOST(req) {
    if (req.method !== 'POST') {
        return Promise.resolve();
    } else {
        return new Promise(function(resolve) {
            // Parse POST data
            var bboy = new Busboy({
                headers: req.headers,
                // Increase the form field size limit from the 1M default.
                limits: { fieldSize: 15 * 1024 * 1024 }
            });
            req.body = req.body || {};
            bboy.on('field', function (field, val) {
                req.body[field] = val;
            });
            bboy.on('finish', function () {
                resolve();
            });
            req.pipe(bboy);
        });
    }
}


// Handle a single request
function handleRequest (req, resp) {

    // Start off by parsing any POST data with BusBoy
    return parsePOST(req)

    // Then process the request
    .then(function() {
        // Create the virtual HTTP service
        var verbs = new Verbs(null, {}, app.frontendRouter, app.backendRouter);

        // Create a new, clean request object
        var urlData = parseURL(req.url);
        var newReq = {
            uri: urlData.pathname,
            query: urlData.query,
            method: req.method,
            headers: req.headers,
            body: req.body
        };
        return verbs.request(newReq);
    })

    // And finally handle the response
    .then(function(response) {
        //console.log('resp', response);
        var body = response.body;
        if (body) {
            // Convert to a buffer
            if (body.constructor === Object) {
                body = new Buffer(JSON.stringify(body));
            } else if (body.constructor !== Buffer) {
                body = new Buffer(body);
            }
            if (!response.headers) {
                response.headers = {};
            }
            response.headers.connection = 'close';
            response.headers['content-length'] = body.length;
            resp.writeHead(response.status || 500, '', response.headers);
            resp.end(body);
        } else {
            resp.writeHead(response.status || 500, '', response.headers);
            resp.end();
        }

    })
    .catch (function(e) {
        log('error/request', e, e.stack);
        // XXX: proper error reporting
        resp.writeHead(500, "Internal error");
        resp.end(e);
    });
}

// Main app setup
function main() {
    // Load handlers & set up routers
    return Promise.all([
            RouteSwitch.fromHandlers('./handlers/frontend', log),
            RouteSwitch.fromHandlers('./handlers/backend', log)
            ])
    .then(function(routers) {
        app.frontendRouter = routers[0];
        app.backendRouter = routers[1];
        var server = http.createServer(handleRequest);
        server.listen(8888);
        log('notice', 'listening on port 8888');
    })
    .catch(function(e) {
        log('error', e, e.stack);
    });
}

if (module.parent === null) {
    main();
} else {
    module.exports = main;
}
