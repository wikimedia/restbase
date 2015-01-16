"use strict";

/*
 * RESTBase web service entry point
 *
 * Sets up a restbase instance by loading and setting up handlers and the
 * storage layer, and then dispatches requests to it.
 */

global.Promise = require('bluebird');

var rbUtil = require('./rbUtil');
var proxyHandler = require('./proxyHandler');
var Restbase = require('./restbase');
var http = require('http');
var fs = require('fs');
var RouteSwitch = require('routeswitch');
var Router = require('./router');
var URI = require('swagger-router').URI;

var app = {
    // The global proxy object
    proxy: null
};

function handleResponse (opts, newReq, resp, response) {
    //console.log('resp', response);
    if (response && response.status) {
        if (!response.headers) {
            response.headers = {};
        }

        // Set up CORS
        response.headers['Access-Control-Allow-Origin'] = '*';
        response.headers['Access-Control-Allow-Methods'] = 'GET';
        response.headers['Access-Control-Allow-Headers'] = 'accept, content-type';

        var body;
        if (response.status >= 400) {
            if (!response.body) {
                response.body = {};
            }
            body = response.body;
            if (response.status === 404) {
                if (!body.type) { body.type = 'not_found'; }
                if (!body.title) { body.title = 'Not found.'; }
                if (!response.headers['content-type']) {
                    response.headers['content-type'] = 'application/problem+json';
                }
            }
            if (response.status >= 400) {
                if (!body.uri) { body.uri = newReq.url; }
                if (!body.method) { body.method = newReq.method; }
            }
            if (!body.type) {
                body.type = 'unknown_error';
            }
            // Prefix error base URL
            // XXX: make the prefix configurable
            body.type = 'https://restbase.org/errors/' + body.type;
        }

        if (response.status >= 500) {
            opts.log('error/request', {req: newReq, res: response, stack: response.stack});
        } else {
            opts.log('info/request', {req: newReq});
        }

        if (response.body) {
            body = response.body;
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
            response.headers.connection = 'close';
            response.headers['content-length'] = body.length;
            resp.writeHead(response.status, '', response.headers);
            resp.end(body);
        } else {
            if (response.headers['content-length']) {
                opts.log('warn/response/content-length', {
                    req: newReq,
                    res: response,
                    reason: new Error('Invalid content-length')
                });
                delete response.headers['content-length'];
            }
            resp.writeHead(response.status, '', response.headers);
            resp.end();
        }
    } else {
        opts.log('error/request', {req: newReq}, "No content returned");
        response.headers['content-type'] = 'application/problem+json';
        resp.writeHead(response && response.status || 500, '', response && response.headers);
        resp.end(JSON.stringify({
            type: 'https://restbase.org/errors/no_content',
            title: 'RESTBase error: No content returned by backend.',
            uri: newReq.url,
            method: newReq.method
        }));
    }
}

// Handle a single request
function handleRequest (opts, req, resp) {
    var newReq;

    opts = {
        log: opts.log.child({
            req: {
                method: req.method,
                uri: req.uri
            }
        }),
        conf: opts.conf
    };



    // Start off by parsing any POST data with BusBoy
    return rbUtil.parsePOST(req)

    // Then process the request
    .then(function() {
        // Create a new, clean request object
        var urlData = rbUtil.parseURL(req.url);
        var body = req.body;

        if (/^application\/json/i.test(req.headers['content-type'])) {
            try {
                body = JSON.parse(req.body.toString());
            } catch (e) {
                opts.log('error/request/json-parsing', e);
            }
        }
        newReq = {
            uri: new URI(urlData.pathname),
            query: urlData.query,
            method: req.method.toLowerCase(),
            headers: req.headers,
            body: body
        };

        // Quick hack to set up general CORS
        // XXX: move to a handler later? Will probably need per-method
        // routeswitch instances for that.
        if (newReq.method === 'options') {
            return Promise.resolve({
                status: 200
            });
        } else {
            return app.restbase.request(newReq);
        }
    })

    // And finally handle the response
    .then(function(result) {
        return handleResponse(opts, newReq, resp, result);
    })
    .catch (function(e) {
        if (e && !(e instanceof rbUtil.HTTPError)) {
            var stack = e.stack;
            e = new rbUtil.HTTPError({
                status: 500,
                body: {
                    type: 'internal_error',
                    description: e.toString(),
                    // Probably better to keep this private for now
                    //stack: e.stack
                }
            });
            // Log this internally
            e.stack = stack;
        }
        if (!e.status) {
            e.status = 500;
        }
        return handleResponse(opts, newReq, resp, e);
    });
}

function setupConfigDefaults(conf) {
    if (!conf) { conf = {}; }
    if (!conf.logging) { conf.logging = {}; }
    if (!conf.logging.name) { conf.logging.name = 'restbase'; }
    if (!conf.logging.level) { conf.logging.level = 'warn'; }
    if (!conf.sysdomain) { conf.sysdomain = "restbase.local"; }
    if (!conf.storage) { conf.storage = {}; }
    if (!conf.storage['default']) {
        conf.storage['default'] = {
            // module name
            type: "restbase-cassandra",
            hosts: ["localhost"],
            keyspace: "system",
            username: "cassandra",
            password: "cassandra",
            defaultConsistency: 'one' // use localQuorum in production
        };
    }
    return conf;
}

// Main app setup
function main(conf) {
    conf = setupConfigDefaults(conf);
    // Set up the global options object with a logger
    var opts = {
        log: rbUtil.makeLogger(conf.logging),
        conf: conf
    };

    // TODO: actually make tree building / spec loading async!
    opts.router = new Router(opts);
    app.restbase = new Restbase(opts);
    return opts.router.loadSpec(conf.spec, app.restbase)
    .then(function(router) {
        //console.log(JSON.stringify(router.tree, null, 2));
        opts.router = router;
        var server = http.createServer(handleRequest.bind(null, opts));
        // Use a large listen queue
        // Also, echo 1024 | sudo tee /proc/sys/net/core/somaxconn
        // (from 128 default)
        var port = conf.port || 7231;
        // Apply some back-pressure.
        server.maxConnections = 500;
        server.listen(port);
        opts.log('info', 'listening on port ' + port);
        return server;
    })
    .catch(function(e) {
        opts.log('fatal/startup', e.stack);
    });
}

if (module.parent === null) {
    main();
} else {
    module.exports = main;
}
