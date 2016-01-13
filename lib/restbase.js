'use strict';

/*
 * RESTBase request dispatcher and general shared per-request state namespace
 */

var jwt = require('jsonwebtoken');
var P = require('bluebird');
var rbUtil = require('./rbUtil');
var HTTPError = rbUtil.HTTPError;
var preq = require('preq');
var swaggerUI = require('./swaggerUI');
var AuthService = require('./auth');

function RESTBase(options, req) {
    if (options && options.constructor === RESTBase) {
        // Child instance
        var par = options;
        this.log = par.log;
        this.metrics = par.metrics;
        this.reqId = par.reqId ||
            req && req.headers && req.headers['x-request-id'] ||
            rbUtil.generateRequestId();

        this._parent = par;
        // Remember the request that led to this child instance at each level, so
        // that we can provide nice error reporting and tracing.
        this._req = req;
        this._recursionDepth = par._recursionDepth + 1;
        this._priv = par._priv;
        this.rb_config = this._priv.options.conf;
        this._rootReq = par._rootReq || req;
        this._forwardedHeaders = par._forwardedHeaders || this._rootReq.headers;
        this._authService = par._authService ? new AuthService(par._authService) : null;
    } else {
        // Brand new instance
        this.log = options.log; // Logging method
        this.metrics = options.metrics;
        this.reqId = null;

        // Private
        this._parent = null;
        this._req = null;
        this._recursionDepth = 0;

        options.maxDepth = options.maxDepth || 10;

        if (!options.conf.salt || typeof options.conf.salt !== 'string') {
            throw new Error("Missing or invalid `salt` option in RESTBase config. "
                    + "Expected a string.");
        }

        // Private state, shared with child instances
        this._priv = {
            options: options,
            router: options.router
        };

        this.rb_config = options.conf;
        this.rb_config.user_agent = this.rb_config.user_agent || 'RESTBase';
        this._rootReq = null;
        this._forwardedHeaders = null;
        this._authService = null;
    }
}

// Sets the request id for this instance and adds it to
// the request header, if defined
RESTBase.prototype.setRequestId = function(req) {

    req.headers = req.headers || {};
    if (req.headers['x-request-id']) {
        return;
    }
    req.headers['x-request-id'] = this.reqId;

};

// Make a child instance
RESTBase.prototype.makeChild = function(req) {
    return new RESTBase(this, req);
};

// A default listing handler for URIs that end in / and don't have any
// handlers associated with it otherwise.
RESTBase.prototype.defaultListingHandler = function(value, restbase, req) {
    var rq = req.query;
    if (rq.spec !== undefined && value.specRoot) {
        var spec = Object.assign({}, value.specRoot, {
            // Set the base path dynamically
            basePath: req.uri.toString().replace(/\/$/, '')
        });

        if (req.params.domain === req.headers.host.replace(/:[0-9]+$/, '')) {
            // This is a host-based request. Set an appropriate base path.
            spec.basePath = spec['x-host-basePath'] || spec.basePath;
        }

        return P.resolve({
            status: 200,
            body: spec
        });
    } else if (rq.doc !== undefined) {
        // Return swagger UI & load spec from /?spec
        if (!req.query.path) {
            req.query.path = '/index.html';
        }
        return swaggerUI(restbase, req);
    } else if (/\btext\/html\b/.test(req.headers.accept)
            && req.uri.path.length <= 2) {
        // Browser request and above api level
        req.query.path = '/index.html';
        var html = '<div id="swagger-ui-container" class="swagger-ui-wrap">'
                    + '<div class="info_title">Wikimedia REST API</div>';
        if (req.uri.path.length === 1) {
            html += '<h2>Domains:</h2>'
                    + '<div class="info_description markdown"><ul>'
                    + req.params._ls.map(function(domain) {
                        return '<li><a href="' + encodeURIComponent(domain)
                            + '/v1/?doc">' + domain + '</a></li>';
                    }).join('\n')
                    + '</ul></div>';
        } else {
            html += '<h2>APIs:</h2>'
                    + '<div class="info_description markdown"><ul>'
                    + req.params._ls.filter(function(item) {
                            return item !== 'sys';
                        })
                        .map(function(api) {
                        return '<li><a href="' + encodeURIComponent(api)
                            + '/?doc">' + api + '</a></li>';
                    }).join('\n')
                    + '</ul>';
        }
        html += "<h3>JSON listing</h3><p>To retrieve a regular JSON listing, you can either "
            + "omit the <code>Accept</code> header, or send one that does not contain "
            + "<code>text/html</code>.</p></div>";

        return swaggerUI(restbase, req)
        .then(function(res) {
            res.body = res.body
                .replace(/window\.swaggerUi\.load/, '')
                .replace(/<div id="swagger-ui-container" class="swagger-ui-wrap">/, html);
            return res;
        });
    } else {
        // Plain listing
        return P.resolve({
            status: 200,
            body: {
                items: req.params._ls
            }
        });
    }
};

// Special handling for external web requests
RESTBase.prototype.defaultWebRequestHandler = function(req) {
    // Enforce the usage of UA
    req.headers = req.headers || {};
    req.headers['user-agent'] = req.headers['user-agent'] || this.rb_config.user_agent;
    if (this._authService) {
        this._authService.prepareRequest(this, req);
    }
    this.setRequestId(req);
    this.log('trace/webrequest', {
        req: req,
        request_id: req.headers['x-request-id']
    });
    // Make sure we have a string
    req.uri = '' + req.uri;
    // Call P.resolve to make sure we have a bluebird Promise
    return P.resolve(preq(req));
};

RESTBase.prototype._isSysRequest = function(req) {
    return ((req.uri.params && req.uri.params.api === 'sys')
        // TODO: Remove once params.api is reliable
            || (req.uri.path && req.uri.path.length > 1 && req.uri.path[1] === 'sys'));
};

/**
 * Checks if the maximum recursion depth has been exceeded by the request.
 * If yes, the 500 error is thrown, othervise this is a no-op
 *
 * @param {Object} req - a current request object
 * @private
 */
RESTBase.prototype._checkMaxRecursionDepth = function(req) {
    if (this._recursionDepth > this._priv.options.maxDepth) {
        var parents = [];
        var rb = this._parent;
        while (rb) {
            parents.push(rb._req);
            rb = rb._parent;
        }
        throw new HTTPError({
            status: 500,
            body: {
                type: 'request_recursion_depth_exceeded',
                title: 'RESTBase request recursion depth exceeded.',
                uri: req.uri,
                method: req.method,
                parents: parents,
                depth: this._recursionDepth
            }
        });
    }
};

/**
 * Protects /sys APIs from the direct access.
 *
 * @param {Object} req - an original request
 * @private
 */
RESTBase.prototype._checkInternalApiRequest = function(req) {
    if (this._recursionDepth === 0 && this._isSysRequest(req)) {
        throw new HTTPError({
            status: 403,
            body: {
                type: 'access_denied#sys',
                title: 'Access to the /sys hierarchy is restricted to system users.'
            }
        });
    }
};

RESTBase.prototype.request = function(req) {
    if (req.method) {
        req.method = req.method.toLowerCase();
    }
    return this._request(req);
};

RESTBase.prototype._wrapInMetrics = function(handlerPromise, match, req) {
    var self = this;
    // Remove the /{domain}/ prefix, as it's not very useful in stats
    var statName = match.value.path.replace(/\/[^\/]+\//, '')
            + '.' + req.method.toUpperCase() + '.';
    // Normalize invalid chars
    statName = self.metrics.normalizeName(statName);
    // Start timer
    var startTime = Date.now();

    return handlerPromise.then(function(res) {
        // Record request metrics & log
        var statusClass = Math.floor(res.status / 100) + 'xx';
        self.metrics.endTiming([statName + statusClass, statName + 'ALL'], startTime);
        return res;
    },
    function(err) {
        var statusClass = '5xx';
        if (err && err.status) {
            statusClass = Math.floor(err.status / 100) + 'xx';
        }
        self.metrics.endTiming([statName + statusClass, statName + 'ALL'], startTime);
        throw err;
    });
};

RESTBase.prototype._wrapInAccessCheck = function(handlerPromise, match, childReq) {
    var self = this;
    // Don't need to check access restrictions on /sys requests,
    // as these endpoints are internal, so can be accessed only
    // within RESTBase. (See RESTBase.prototype.request) All required
    // checks should be added and made at the root of the request chain,
    // at /v1 level
    if (!this._isSysRequest(childReq)
            && match.permissions
            && Array.isArray(match.permissions)
            && match.permissions.length) {
        self._authService = self._authService || new AuthService(match.value.specRoot);
        self._authService.addRequirements(match.permissions);
        if (childReq.method === 'get' || childReq.method === 'head') {
            return P.all([
                handlerPromise,
                self._authService.checkPermissions(self, childReq)
            ])
            .then(function(res) { return res[0]; });
        } else {
            return self._authService.checkPermissions(self, childReq)
            .then(function() { return handlerPromise; });
        }
    } else {
        return handlerPromise;
    }
};

// Process one request
RESTBase.prototype._request = function(req) {
    var self = this;

    // Special handling for https? requests
    if (req.uri.constructor === String && /^https?:\/\//.test(req.uri)
            || req.uri.urlObj) {
        return self.defaultWebRequestHandler(req);
    }

    self._checkMaxRecursionDepth(req);

    // Make sure we have a sane & uniform request object that doesn't change
    // (at least at the top level) under our feet.
    var childReq = rbUtil.cloneRequest(req);
    var match = this._priv.router.route(childReq.uri);
    var methods = match && match.value && match.value.methods;
    var handler = methods && (
            (self._rootReq && self._rootReq.method === 'head' && methods.head)
                || methods[childReq.method]
                || methods.all);
    if (!handler &&
            (req.method === 'head'
            || self._rootReq && self._rootReq.method === 'head')) {
        handler = methods && methods.get;
    }

    if (match && !handler
            && childReq.method === 'get'
            && childReq.uri.path[childReq.uri.path.length - 1] === '') {
        // A GET for an URL that ends with /: return a default listing
        if (!match.value) { match.value = {}; }
        if (!match.value.path) { match.value.path = '_defaultListingHandler'; }
        handler = function(restbase, req) {
            return self.defaultListingHandler(match.value, restbase, req);
        };
    }

    if (match) {
        childReq.params = match.params;
        self._checkInternalApiRequest(childReq);
    }

    if (handler) {
        // Prepare to call the handler with a child restbase instance
        var childRESTBase = this.makeChild(childReq);

        // Call the handler with P.try to catch synchronous exceptions.
        var reqHandlerPromise;
        if (handler.validator) {
            reqHandlerPromise = P.try(function() {
                return handler.validator.validate(childReq);
            })
            .then(function() {
                return handler(childRESTBase, childReq);
            });
        } else {
            reqHandlerPromise = P.try(handler, [childRESTBase, childReq]);
        }

        reqHandlerPromise = self._wrapInMetrics(reqHandlerPromise, match, req)
        .then(function(res) {
            self.log('trace', {
                req: req,
                res: res,
                request_id: childRESTBase.reqId
            });

            if (!res) {
                throw new HTTPError({
                    status: 500,
                    body: {
                        type: 'empty_response',
                        description: 'Empty response received',
                        req: req
                    }
                });
            } else if (!(res.status >= 100 && res.status < 400) && !(res instanceof Error)) {
                var err = new HTTPError(res);
                if (res.body && res.body.stack) { err.stack = res.body.stack; }
                err.innerBody = res.body;
                err.internalReq = childReq;
                throw err;
            } else {
                return res;
            }
        });

        return childRESTBase._wrapInAccessCheck(reqHandlerPromise, match, childReq);
    } else {
        // No handler found.
        throw new HTTPError({
            status: 404,
            body: {
                type: 'not_found#route',
                title: 'Not found.',
                internalURI: req.uri,
                method: req.method,
                depth: self._recursionDepth
            }
        });
    }
};

// Generic parameter massaging:
// * If last parameter is an object, it is expected to be the request object.
// * If the first parameter is a string, it's expected to be the URL.
// * If the second parameter is a String or Buffer, it's expected to be a
//   resource body.
function makeRequest(uri, reqOrBody, method) {
    var req;
    if (uri.constructor === Object) {
        // Fast path
        req = uri;
        req.method = method;
        return req;
    } else if (reqOrBody && reqOrBody.constructor === Object) {
        req = reqOrBody;
        req.uri = uri;
        req.method = method;
    } else {
        req = {
            uri: uri,
            method: method,
            body: reqOrBody
        };
    }
    return req;
}

// Convenience wrappers
var methods = ['get', 'post', 'put', 'delete', 'head', 'options',
    'trace', 'connect', 'copy', 'move', 'purge', 'search'];
methods.forEach(function(method) {
    RESTBase.prototype[method] = function(uri, req) {
        return this._request(makeRequest(uri, req, method));
    };
});


// Utility methods that need access to restbase state.

// Create a json web token
// @param {string} token
// @return {string} JWT signed token
RESTBase.prototype.encodeToken = function(token) {
    var newToken = jwt.sign({ next: token }, this._priv.options.conf.salt);
    return newToken;
};

// Decode signed token and decode the orignal token
// @param {string} JWT token
// @return {string} original token
RESTBase.prototype.decodeToken = function(token) {
    try {
        var next = jwt.verify(token, this._priv.options.conf.salt);
        return next.next;
    } catch (e) {
        throw new HTTPError({
            status: 400,
            body: {
                type: 'invalid_paging_token',
                title: 'Invalid paging token'
            }
        });
    }
};

module.exports = RESTBase;
