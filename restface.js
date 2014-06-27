"use strict";
var fs = require('fs'),
    path = require('path'),
    prfun = require('prfun'),
    RouteSwitch = require('routeswitch'),
    Verbs = require('./Verbs'),
    pathToRegexp = require('path-to-regexp'),
    readdir = Promise.promisify(fs.readdir),
    express = require('express'),
    log = function (level, msg) {
        if (/^error/.test(level)) {
            console.error(arguments);
        } else {
            console.log(arguments);
        }
    };

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
    console.log(kind, allRoutes);
    return new RouteSwitch(allRoutes);
}

// Handle a single request
function* handleRequestGen (req, resp) {
    console.log('New request:', req.path);
    var verbs = new Verbs(null, {}, req.app.frontendRouter, req.app.backendRouter);
    try {
        var newReq = {
            uri: req.path,
            method: req.method.toLowerCase(),
            headers: req.headers,
            query: req.query
        };
        var response = yield* verbs.request(newReq);

        if (response.headers) {
            resp.set(response.headers);
        }

        if (response.body) {
            resp.send(response.status || 500, response.body);
        }

    } catch (e) {
        log('error/request', e, e.stack);
		// XXX: proper error reporting
		resp.send(500, e);
    }
}
var handleRequest = Promise.async(handleRequestGen);


// Main app setup
function* mainGen() {
    var app = express();
    app.all('*', handleRequest);

    // Load handlers & set up routers
    app.frontendRouter = yield* makeRouter('frontend');
    app.backendRouter = yield* makeRouter('backend');

    app.listen(8888);
    console.log('listening on port 8888');
}
var main = Promise.async(mainGen);

main()
.catch(function(e) {
	log('error', e, e.stack);
});
