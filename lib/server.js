"use strict";

/*
 * RESTBase web service entry point
 *
 * Sets up a restbase instance by loading and setting up handlers and the
 * storage layer, and then dispatches requests to it.
 */

var P = require('bluebird');
var Busboy = require('busboy');
var qs = require('querystring');
var url = require('url');
var http = require('http');
var zlib = require('zlib');
var stream = require('stream');

var URI = require('swagger-router').URI;

var exports = require('./exports');
var Restbase = require('./restbase');
var Router = require('./router');
var utils = require('./utils');


// Should make it into 0.12, see https://github.com/joyent/node/pull/7878
var SIMPLE_PATH = /^(\/(?!\/)[^\?#\s]*)(?:\?([^#\s]*))?$/;
function parseURL(uri) {
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


/**
 * Parse a POST request into request.body with BusBoy
 * Drops file uploads on the floor without creating temporary files
 *
 * @param {Request} req HTTP request
 * @returns {Promise<>}
 */
function read(req) {
    return new P(function(resolve) {
        var chunks = [];
        req.on('data', function(chunk) {
            chunks.push(chunk);
        });

        req.on('end', function() {
            resolve(Buffer.concat(chunks));
        });
    });
}

function parsePOST(req) {
    var readIt = (req.method === 'PUT') ||
        (req.method === 'POST' && req.headers &&
            (/^application\/json/i.test(req.headers['content-type'])
            || !req.headers['content-type']));

    if (readIt) {
        return read(req);
    } else if (req.method !== 'POST') {
        return P.resolve();
    } else {
        // Parse the POST
        return new P(function(resolve) {
            // Parse POST data
            var bboy = new Busboy({
                headers: req.headers,
                // Increase the form field size limit from the 1M default.
                limits: { fieldSize: 15 * 1024 * 1024 }
            });
            var body = {};
            bboy.on('field', function(field, val) {
                body[field] = val;
            });
            bboy.on('finish', function() {
                resolve(body);
            });
            req.pipe(bboy);
        });
    }
}

function handleResponse(opts, req, resp, response) {
    if (response && response.status) {
        if (!response.headers) {
            response.headers = {};
        }

        var rh = response.headers;

        // Default to no server-side caching
        if (!rh['cache-control']) {
            rh['cache-control'] = 'private, max-age=0, s-maxage=0, must-revalidate';
        }

        // Set up CORS
        rh['access-control-allow-origin'] = '*';
        rh['access-control-allow-methods'] = 'GET';
        rh['access-control-allow-headers'] = 'accept, content-type';
        rh['access-control-expose-headers'] = 'etag';

        // Set up security headers
        // https://www.owasp.org/index.php/List_of_useful_HTTP_headers
        rh['x-content-type-options'] = 'nosniff';
        rh['x-frame-options'] = 'SAMEORIGIN';

        exports.misc.addCSPHeaders(response, { domain: req.params && req.params.domain });

        // Propagate the request id header
        rh['x-request-id'] = opts.reqId;

        var logLevel = 'trace/request';
        if (response.status >= 500) {
            logLevel = 'error/request';
        } else if (response.status >= 400) {
            logLevel = 'info/request';
        }
        opts.log(logLevel, {
            message: response.message,
            req: req,
            res: response,
            stack: response.stack
        });

        var body;
        // Prepare error responses for the client
        if (response.status >= 400) {
            if (!response.body) {
                response.body = {};
            }
            // Whitelist fields to avoid leaking sensitive info
            var rBody = response.body;
            body = {
                type: rBody.type,
                title: rBody.title,
                method: rBody.method,
                detail: rBody.detail || rBody.description,
                uri: rBody.uri
            };

            if (!response.headers['content-type']) {
                response.headers['content-type'] = 'application/problem+json';
            }

            if (response.status === 404) {
                if (!body.type) { body.type = 'not_found'; }
                if (!body.title) { body.title = 'Not found.'; }
            }

            if (response.status >= 400) {
                if (!body.uri) { body.uri = req.uri; }
                if (!body.method) { body.method = req.method; }
            }

            if (!body.type) {
                body.type = 'unknown_error';
            }

            // Prefix error base URL
            // XXX: make the prefix configurable
            body.type = 'https://restbase.org/errors/' + body.type;
            response.body = body;
        }

        if (req.method === 'head') {
            delete response.headers['content-length'];
            delete response.body;
        }

        if (response.body) {
            body = response.body;
            var bodyIsStream = body instanceof stream.Readable;
            if (!Buffer.isBuffer(body) && !bodyIsStream) {
                // Convert to a buffer
                if (typeof body === 'object') {
                    if (!response.headers['content-type']) {
                        response.headers['content-type'] = 'application/json';
                    }
                    body = new Buffer(JSON.stringify(body));
                } else {
                    body = new Buffer(body);
                }
            }
            var cType = response.headers['content-type'];
            if (/\bgzip\b/.test(req.headers['accept-encoding'])
                    && /^application\/json\b|^text\//.test(cType)) {
                if (response.headers['content-length']) {
                    delete response.headers['content-length'];
                }
                response.headers['content-encoding'] = 'gzip';
                resp.writeHead(response.status, '', response.headers);
                var zStream = zlib.createGzip({ level: 3 });
                zStream.pipe(resp);
                if (bodyIsStream) {
                    body.pipe(zStream);
                } else {
                    zStream.end(body);
                }
            } else if (bodyIsStream) {
                resp.writeHead(response.status, '', response.headers);
                body.pipe(resp);
            } else {
                response.headers['content-length'] = body.length;
                resp.writeHead(response.status, '', response.headers);
                resp.end(body);
            }
        } else {
            if (response.headers['content-length']) {
                opts.log('warn/response/content-length', {
                    req: req,
                    res: response,
                    reason: new Error('Invalid content-length')
                });
                delete response.headers['content-length'];
            }
            resp.writeHead(response.status, '', response.headers);
            resp.end();
        }
    } else {
        opts.log('error/request', {
            req: req,
            msg: "No content returned"
        });

        if (!response) { response = {}; }
        if (!response.headers) { response.headers = {}; }

        response.headers['content-type'] = 'application/problem+json';
        resp.writeHead(response.status || 500, '', response.headers);
        resp.end(req.method === 'head' ? undefined : JSON.stringify({
            type: 'https://restbase.org/errors/no_content',
            title: 'RESTBase error: No content returned by backend.',
            uri: req.url,
            method: req.method
        }));
    }
}

// Handle a single request
function handleRequest(opts, req, resp) {
    // Set the request ID early on for external requests
    req.headers = req.headers || {};
    req.headers['x-request-id'] = req.headers['x-request-id'] || utils.generateRequestId();

    var remoteAddr = req.headers['x-client-ip'] || req.socket.remoteAddress;
    req.headers['x-client-ip'] = remoteAddr;
    req.headers['x-forwarded-for'] = remoteAddr;

    var reqOpts = {
        conf: opts.conf,
        logger: opts.logger.child({
            req: {
                method: req.method.toLowerCase(),
                uri: req.url,
                headers: {
                    'cache-control': req.headers['cache-control'],
                    'content-length': req.headers['content-length'],
                    'content-type': req.headers['content-type'],
                    'if-match': req.headers['if-match'],
                    'user-agent': req.headers['user-agent'],
                    'x-client-ip': req.headers['x-client-ip'],
                    'x-request-id': req.headers['x-request-id'],
                },
            },
            request_id: req.headers['x-request-id']
        }),
        log: null,
        reqId: req.headers['x-request-id'],
        metrics: opts.metrics
    };
    reqOpts.log = reqOpts.logger.log.bind(reqOpts.logger);

    // Simplistic count of requests from public & private networks
    if (/^(?:::ffff:)?(?:10|127)\./.test(remoteAddr)) {
        reqOpts.metrics.increment('requests.private');
    } else {
        reqOpts.metrics.increment('requests.public');
    }

    // Create a new, clean request object
    var urlData = parseURL(req.url);

    var newReq = {
        uri: new URI(urlData.pathname),
        query: urlData.query,
        method: req.method.toLowerCase(),
        headers: req.headers
    };

    // Start off by parsing any POST data with BusBoy
    return parsePOST(req)
    .catchThrow(new exports.HTTPError({
        status: 400,
        body: {
            type: 'invalid_request'
        }
    }))

    // Then process the request
    .then(function(body) {

        if (body && /^application\/json/i.test(req.headers['content-type'])) {
            try {
                body = JSON.parse(body.toString());
            } catch (e) {
                reqOpts.log('error/request/json-parsing', e);
            }
        }

        newReq.body = body;

        // Quick hack to set up general CORS
        if (newReq.method === 'options') {
            return P.resolve({
                status: 200
            });
        } else {
            return opts.restbase.request(newReq);
        }
    })

    // And finally handle the response
    .then(function(result) {
        return handleResponse(reqOpts, newReq, resp, result);
    })
    .catch(function(e) {
        if (!e || e.name !== 'HTTPError') {
            var originalError = e;
            var stack = e && e.stack;
            e = new exports.HTTPError({
                status: 500,
                body: {
                    type: 'internal_error',
                    description: e + ''
                    // Probably better to keep this private for now
                    // stack: e.stack
                }
            });
            // Log this internally
            e.stack = stack;
            e.innerError = originalError;
        }
        if (!e.status) {
            e.status = 500;
        }
        return handleResponse(reqOpts, newReq, resp, e);
    });
}

function setupConfigDefaults(conf) {
    if (!conf) { conf = {}; }
    if (!conf.logging) { conf.logging = {}; }
    if (!conf.logging.name) { conf.logging.name = 'restbase'; }
    if (!conf.logging.level) { conf.logging.level = 'warn'; }
    return conf;
}

// Main app setup
function main(options) {
    var conf = setupConfigDefaults(options.config);
    // Set up the global options object with a logger
    var opts = {
        conf: conf,
        logger: options.logger,
        log: options.logger.log.bind(options.logger),
        metrics: options.metrics
    };

    opts.router = new Router(opts);
    opts.restbase = new Restbase(opts);
    // Use a child restbase instance to sidestep the security protection for
    // direct requests to /sys
    var childRestBase = opts.restbase.makeChild({ uri: '#internal-startup' });
    // Main app startup happens during async spec loading:
    return opts.router.loadSpec(conf.spec, childRestBase)
    .then(function(router) {
        var server = http.createServer(handleRequest.bind(null, opts));
        // Use a large listen queue
        // Also, echo 1024 | sudo tee /proc/sys/net/core/somaxconn
        // (from 128 default)
        var port = conf.port || 7231;
        var host = conf.host;
        // Apply some back-pressure.
        server.maxConnections = 500;
        server.listen(port, host);
        opts.log('info', 'listening on ' + (host || '*') + ':' + port);
        return server;
    })
    .catch(function(e) {
        opts.log('fatal/startup', {
            status: e.status,
            err: e,
            stack: e.body && e.body.stack || e.stack
        });
        // Delay exiting to avoid heavy restart load & let the logger finish its business
        setTimeout(function() {
            process.exit(1);
        }, 2000);
    });
}

if (module.parent === null) {
    main();
} else {
    module.exports = main;
}
