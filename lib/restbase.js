'use strict';

/*
 * RESTBase request dispatcher and general shared per-request state namespace
 */

var P = require('bluebird');
var rbUtil = require('./rbUtil');
var HTTPError = rbUtil.HTTPError;
var preq = require('preq');
var swaggerUI = require('./swaggerUI');

// Create a uniform but shallow request object copy with sane defaults. This
// keeps code dealing with this request monomorphic (good for perf), and
// avoids subtle bugs when requests shared between recursive requests are
// mutated in another control branch. At the very minimum, we are mutating the
// .params property for each sub-request.
function cloneRequest(req) {
    return {
        uri: req.uri || req.url || null,
        method: req.method || 'get',
        headers: req.headers || {},
        query: req.query || {},
        body: req.body || null,
        params: req.params || {}
    };
}

function RESTBase (options, req) {
    if (options && options.constructor === RESTBase) {
        // Child instance
        var par = this._parent = options;
        this.log = par.log;
        this.metrics = par.metrics;
        this.reqId = par.reqId ||
            req && req.headers && req.headers['x-request-id'] ||
            rbUtil.generateRequestId();
        this._recursionDepth = par._recursionDepth + 1;
        this._priv = par._priv;
    } else {
        // Brand new instance
        this.log = options.log; // logging method
        this.metrics = options.metrics;
        this.reqId = null;

        // Private
        this._parent = null;
        this._req = null;
        this._recursionDepth = 0;

        options.maxDepth = options.maxDepth || 10;
        // Private state, shared with child instances
        this._priv = {
            options: options,
            router: options.router
        };
    }

}

// sets the request id for this instance and adds it to
// the request header, if defined
RESTBase.prototype.setRequestId = function(req) {

    req.headers = req.headers || {};
    if(req.headers['x-request-id']) {
        return;
    }
    req.headers['x-request-id'] = this.reqId;

};

// Make a child instance
RESTBase.prototype.makeChild = function(req) {
    var child = new RESTBase(this, req);
    // Remember the request that led to this child instance at each level, so
    // that we can provide nice error reporting and tracing.
    child._req = req;
    return child;
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

        if (req.params.domain === req.headers.host.replace(/:[0-9]+$/,'')) {
            // This is a host-based request. Set an appropriate base path.
            spec.basePath = spec['x-host-basePath'] || '';
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
                .replace(/window\.swaggerUi\.load/,'')
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


// Process one request
RESTBase.prototype.request = function (req) {
    // Protect the sys api from direct access
    // Could consider opening this up with a specific permission later.
    if (this._recursionDepth === 0 &&
            ((req.uri.params && req.uri.params.api === 'sys')
             // TODO: Remove once params.api is reliable
             || (req.uri.path.length > 1 && req.uri.path[1] === 'sys'))) {
        return P.reject(new HTTPError({
            status: 403,
            body: {
                type: 'access_denied#sys',
                title: 'Access to the /{domain}/sys/ hierarchy is restricted to system users.'
            }
        }));
    }

    if (req.method) {
        req.method = req.method.toLowerCase();
    }

    return this._request(req);
};


// Internal request handler
RESTBase.prototype._request = function (req) {
    var self = this;

    // Special handling for https? requests
    if (req.uri.constructor === String && /^https?:\/\//.test(req.uri)
            || req.uri.urlObj) {
        return this.defaultWebRequestHandler(req);
    }

    var priv = this._priv;
    if (this._recursionDepth > priv.options.maxDepth) {
        var parents = [];
        var rb = this._parent;
        while (rb) {
            parents.push(rb._req);
            rb = rb._parent;
        }
        return P.resolve({
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

    // Make sure we have a sane & uniform request object that doesn't change
    // (at least at the top level) under our feet.
    var childReq = cloneRequest(req);

    var match = priv.router.route(childReq.uri);
    var methods = match && match.value && match.value.methods;
    var handler = methods && (methods[childReq.method] || methods.all);

    if (match && !handler
            && childReq.method === 'get'
            && childReq.uri.path[childReq.uri.path.length - 1] === '') {
        // A GET for an URL that ends with /: return a default listing
        if (!match.value) { match.value = {}; }
        if (!match.value.path) { match.value.path = '_defaultListingHandler'; }
        handler = function (restbase, req) {
            return self.defaultListingHandler(match.value, restbase, req);
        };
    }

    if (handler) {
        // TODO: check ACLs in the match object

        // Remove the /{domain}/ prefix, as it's not very useful in stats
        var statName = match.value.path.replace(/\/[^\/]+\//, '')
            + '.' + req.method.toUpperCase() + '.';
        // Normalize invalid chars
        statName = self.metrics.normalizeName(statName);

        // start timer
        var startTime = Date.now();

        // Prepare to call the handler with a child restbase instance
        var childRESTBase = this.makeChild(req);
        childReq.params = match.params;

        // Call the handler with P.try to catch synchronous exceptions.
        return P.try(handler, [childRESTBase, childReq])
        .then(function(res){
            // Record request metrics & log
            var statusClass = Math.floor(res.status / 100) + 'xx';
            self.metrics.endTiming([statName + statusClass, statName + 'ALL'], startTime);

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
            } else if (res.status >= 400 && !(res instanceof Error)) {
                var err = new HTTPError(res);
                if (res.body && res.body.stack) { err.stack = res.body.stack; }
                err.innerBody = res.body;
                err.internalReq = childReq;
                throw err;
            } else {
                return res;
            }
        },
        function(err){
            var statusClass = '5xx';
            if (err && err.status) {
                statusClass = Math.floor(err.status / 100) + 'xx';
            }
            self.metrics.endTiming([statName + statusClass, statName + 'ALL'], startTime);
            throw err;
        });
    } else {
        // No handler found.
        return P.reject(new HTTPError({
            status: 404,
            body: {
                type: 'not_found#route',
                title: 'Not found.',
                internalURI: req.uri,
                method: req.method,
                depth: self._recursionDepth
            }
        }));
    }
};

// Generic parameter massaging:
// * If last parameter is an object, it is expected to be the request object.
// * If the first parameter is a string, it's expected to be the URL.
// * If the second parameter is a String or Buffer, it's expected to be a
//   resource body.
function makeRequest (uri, reqOrBody, method) {
    var req;
    if (uri.constructor === Object) {
        // fast path
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

module.exports = RESTBase;
