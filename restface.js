"use strict";

/*
 * Simple RestFace server
 *
 * Using node 0.11+:
 *   node --harmony restface
 *
 * Simple benchmark:
 * ab -c10 -n10000 'http://localhost:8888/v1/enwiki/pages/foo/rev/latest/html'
 */

var fs = require('fs'),
    path = require('path'),
    prfun = require('prfun'),
    url = require('url'),
    qs = require('querystring'),
    RouteSwitch = require('routeswitch'),
    Verbs = require('./Verbs'),
    pathToRegexp = require('path-to-regexp'),
    readdir = Promise.promisify(fs.readdir),
    http = require('http'),
    // TODO: use bunyan or the Parsoid logger backend!
    log = function (level) {
        var msg = JSON.stringify(Array.prototype.slice.call(arguments), null, 2);
        if (/^error/.test(level)) {
            console.error(msg);
        } else {
            console.log(msg);
        }
    },
    app = {};

// Load all handlers from the handlers directory
function loadHandlers (kind) {
    return readdir('./handlers/' + kind)
    .then(function(handlerNames) {
        var handlers = [];
        handlerNames.forEach(function(handlerName) {
            try {
                handlers.push(require(path.resolve('./handlers/'
                            + kind + '/' + handlerName)));
            } catch (e) {
                log('error/handler', e, handlerName, e.stack);
            }
        });
        return handlers;
    });
}

function makeRouter (kind) {
	// Load routes & handlers
    return loadHandlers(kind)
    .then(function(handlers) {
        var allRoutes = [];
        handlers.forEach(function(handler) {
            handler.routes.forEach(function(route) {
                allRoutes.push({
                    pattern: route.path,
                    methods: route.methods
                });
            });
        });
        log('notice', kind, allRoutes);
        return new RouteSwitch(allRoutes);
    });
}

// Optimized URL parsing
// XXX: contribute patch to node proper?
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


// Handle a single request
function handleRequest (req, resp) {
    //log('request', 'New request:', req.url);
    var urlData = parseURL(req.url);

    // Create the virtual HTTP service
    var verbs = new Verbs(null, {}, app.frontendRouter, app.backendRouter);
    var newReq = {
        uri: urlData.pathname,
        query: urlData.query,
        method: req.method.toLowerCase(),
        headers: req.headers
    };
    return verbs.request(newReq)
    .then(function(response) {
        var body = response.body;
        if (body) {
            // Convert to a buffer
            if (body.constructor === Object) {
                body = new Buffer(JSON.stringify(body));
            } else if (body.constructor !== Buffer) {
                body = new Buffer(body);
            }
            response.headers.Connection = 'close';
            response.headers['Content-Length'] = body.length;
            resp.writeHead(response.status || 500, '', response.headers);
            resp.end(body);
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
            makeRouter('frontend'),
            makeRouter('backend')
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

main();
