"use strict";
var fs = require('fs'),
    path = require('path'),
    prfun = require('prfun'),
    RouteSwitch = require('routeswitch'),
    Verbs = require('./Verbs'),
    pathToRegexp = require('path-to-regexp'),
    readdir = Promise.promisify(fs.readdir),
    http = require('http'),
    log = function (level) {
        var msg = JSON.stringify(Array.prototype.slice.call(arguments), null, 2);
        if (/^error/.test(level)) {
            console.error(msg);
        } else {
            console.log(msg);
        }
    },
    app = {};

function isGenerator(fn) {
    return fn.constructor === function*(){}.constructor;
}

// Load all handlers from the handlers directory
function* loadHandlers (kind) {
    var handlerNames = yield readdir('./handlers/' + kind),
        handlers = [];
    handlerNames.forEach(function(handlerName) {
        try {
            handlers.push(require(path.resolve('./handlers/'
                        + kind + '/' + handlerName)));
        } catch (e) {
            log('error/handler', e, handlerName, e.stack);
        }
    });
    return handlers;
}

function* makeRouter (kind) {
	// Load routes & handlers
    var handlers = yield* loadHandlers(kind);
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
}

// Handle a single request
function* handleRequestGen (req, resp) {
    //log('request', 'New request:', req.path);
    var verbs = new Verbs(null, {}, app.frontendRouter, app.backendRouter);
    try {
        var newReq = {
            uri: req.url,
            method: req.method.toLowerCase(),
            headers: req.headers,
            query: req.query
        };
        var response = yield* verbs.request(newReq);

        if (response.body) {
            resp.writeHead(response.status || 500, '', response.headers);
            resp.end(response.body);
        }

    } catch (e) {
        log('error/request', e, e.stack);
		// XXX: proper error reporting
		resp.writeHead(500, "Internal error");
        resp.end(e);
    }
}
var handleRequest = Promise.async(handleRequestGen);


// Main app setup
function* mainGen() {
    // Load handlers & set up routers
    app.frontendRouter = yield* makeRouter('frontend');
    app.backendRouter = yield* makeRouter('backend');

    var server = new http.Server();
    server.on('request', handleRequest);
    server.listen(8888);
    yield log('notice', 'listening on port 8888');
}
var main = Promise.async(mainGen);

main()
.catch(function(e) {
	log('error', e, e.stack);
});
