"use strict";

/*
 * RESTBase web service entry point
 *
 * Sets up a restbase instance by loading and setting up handlers and the
 * storage layer, and then dispatches requests to it.
 */

var fs = require('fs');
if (!global.Promise) {
    global.Promise = require('bluebird');
} else if (!Promise.promisify) {
    // Node 0.11+
    Promise.promisify = require('bluebird').promisify;
}
var util = require('./util');
var Restbase = require('./restbase');
var http = require('http');
var RouteSwitch = require('routeswitch');

var app = {
    // The global proxy object
    proxy: null
};

var opts = {
    // Log method
    log: util.log
};

// Handle a single request
function handleRequest (req, resp) {

    // Start off by parsing any POST data with BusBoy
    return util.parsePOST(req)

    // Then process the request
    .then(function() {
        // Create a new, clean request object
        var urlData = util.parseURL(req.url);
        var body = req.body;

        if (/^application\/json/i.test(req.headers['content-type'])) {
            try {
                body = JSON.parse(req.body.toString());
            } catch (e) {
                console.error(e);
            }
        }
        var newReq = {
            uri: urlData.pathname,
            query: urlData.query,
            method: req.method.toLowerCase(),
            headers: req.headers,
            body: body
        };
        return app.restbase.request(newReq);
    })

    // And finally handle the response
    .then(function(response) {
        //console.log('resp', response);
        if (response && response.status) {
            if (response.status >= 400) {
                if (!response.body) {
                    response.body = {};
                }
                var body = response.body;
                if (response.status === 404) {
                    if (!body.type) { body.type = 'not_found'; }
                    if (!body.title) { body.title = 'Not found.'; }
                }
                if (response.status >= 400) {
                    if (!body.uri) { body.uri = req.url; }
                    if (!body.method) { body.method = req.method.toLowerCase(); }
                }
                if (response.body.type) {
                    // Prefix error base URL
                    // XXX: make the prefix configurable
                    response.body.type = 'https://restbase.org/errors/'
                                            + response.body.type;
                }
            }
            if (response.body) {
                var body = response.body;
                // Convert to a buffer
                if (!Buffer.isBuffer(body)) {
                    if (typeof body === 'object') {
                        if (!response.headers['content-type']) {
                            response.headers['content-type'] = 'application/json';
                        }
                        body = new Buffer(JSON.stringify(body));
                    } else  {
                        body = new Buffer(body);
                    }
                }
                if (!response.headers) {
                    response.headers = {};
                }
                response.headers.connection = 'close';
                response.headers['content-length'] = body.length;
                resp.writeHead(response.status, '', response.headers);
                resp.end(body);
            } else {
                resp.writeHead(response.status, '', response.headers);
                resp.end();
            }
        } else {
            resp.writeHead(response && response.status || 500, '', response && response.headers);
            resp.end(JSON.stringify({
                type: 'https://restbase.org/errors/no_content',
                title: 'RESTBase error: No content returned by backend.',
                uri: req.url,
                method: req.method.toLowerCase()
            }));
        }

    })
    .catch (function(e) {
        opts.log('error/request', e, e.stack);
        // XXX: proper error reporting
        resp.writeHead(500, "Internal error");
        resp.end(e.stack);
    });
}

// Main app setup
function main() {
    // Load handlers & set up routers
    var storageRouter;
    return require('./storage')({log: util.log})
    .then(function(store) {
        storageRouter = new RouteSwitch.fromHandlers([store]);
        var handlerDirs = [__dirname + '/filters/global'];
        return RouteSwitch.fromDirectories(handlerDirs, opts.log);
    })
    .then(function(proxyRouter) {
        app.restbase = new Restbase([proxyRouter, storageRouter], opts);
        var server = http.createServer(handleRequest);
        // Use a large listen queue
        // Also, echo 1024 | sudo tee /proc/sys/net/core/somaxconn
        // (from 128 default)
        server.listen(8888, null, 6000);
        util.log('notice', 'listening on port 8888');
    })
    .catch(function(e) {
        util.log('error', e);
    });
}

if (module.parent === null) {
    main();
} else {
    module.exports = main;
}
