"use strict";
var fs = require('fs'),
    path = require('path'),
    prfun = require('prfun'),
    RouteSwitch = require('routeswitch'),
    pathToRegexp = require('path-to-regexp'),
    readdir = Promise.promisify(fs.readdir),
    express = require('express'),
    log = function (level, msg) {
        if (/^error/.test(level)) {
            console.error(msg);
        } else {
            console.log(msg);
        }
    };

function isGenerator(fn) {
    return fn.constructor === function*(){}.constructor;
}

// Load all handlers from the handlers directory
function* loadHandlersGen () {
    var handlerNames = yield readdir('./handlers'),
        handlers = [];
    handlerNames.forEach(function(handlerName) {
        try {
            handlers.push(require(path.resolve('./handlers/' + handlerName)));
        } catch (e) {
            log('error/handler', e, handlerName);
        }
    });
    return handlers;
}
var loadHandlers = Promise.async(loadHandlersGen);

// Handle a single request
function* handleRequestGen (req, resp) {
    console.log('New request:', req.path);
    var match = req.app.myRouter.match(req.path);
    if (!match) {
        return resp.send('404');
    }
    console.log(req.path, match.route, req.method);
    var methods = match.route.methods;
    var method = req.method.toLowerCase();
    var handler = methods[method] && methods[method].handler
                    || methods['all'];
    if (!handler) {
        return resp.end('404');
    }
    try {
        // var req = massageReq(req);
        var restFaceInterface = {
            GET: function() { return { status: 200, body: 'mock!' }; },
            PUT: function() {},
            POST: function() {}
        };

		// Call the end point handler to do the actual work
        var response = yield *handler(restFaceInterface, req);

        if (response.headers) {
            resp.set(response.headers);
        }

        if (response.body) {
            resp.send(response.status || 500, response.body);
        }

    } catch (e) {
        log('error/request', e);
		// XXX: proper error reporting
		resp.send(500, e);
    }
}
var handleRequest = Promise.async(handleRequestGen);

// Main app setup
function* mainGen() {
    var app = express();
	// Load routes & handlers
    var handlers = yield loadHandlers();
    var allRoutes = [];
    handlers.forEach(function(handler) {
        handler.routes.forEach(function(route) {
            allRoutes.push({
                pattern: route.path,
                methods: route.methods
            });
        });
    });
    app.myRouter = new RouteSwitch(allRoutes);
    app.all('*', handleRequest);

    app.listen(8888);
    console.log('listening on port 8888');
}
var main = Promise.async(mainGen);

main()
.catch(function(e) {
	log('error', e);
});
