'use strict';

/*
 * RESTBase proxy layer
 *
 * Dispatches a request to
 * - A matching proxy handler, or
 * - A back-end handler iff
 *   - there is no front-end match
 *   - the request would map to the proxy handler making the request.
 */

function RESTBase (routers, options) {
    this.options = options;
    this.log = options.log; // logging method
    this._routers = routers.filter(function(r) {
        return r.routes && r.routes.length;
    });
    //console.log(JSON.stringify(this._routers, null, 2));
}

RESTBase.prototype.request = function request (req) {
    var self = this;
    if (req.__depth > this.options.maxDepth) {
        return Promise.resolve({
            status: 500,
            body: {
                type: 'proxy_recursion_depth_exceeded',
                title: 'RESTBase handler recursion depth exceeded.',
                uri: req.uri,
                method: req.method,
                depth: req.__depth
            }
        });
    }

    // COW for the request
    // jshint proto: true
    var childReq = { __proto__: req };
    if (!childReq.query) {
        req.query = {};
    }

    var i = 0;
    // jshint proto: true
    var parentReq = this.__parentReq;
    if (parentReq && req.uri === parentReq.uri) {
        // URL didn't change, jump to the next layer
        if (this.storageHandler) {
            // Normally used to call from a bucket straight to the storage
            // router.
            // XXX: match signature in storage.js
            return this.storageHandler(this, childReq);
        }
        i = (this.__layer || 0) + 1;
    }

    for (; i < this._routers.length; i++) {
        var match = this._routers[i].match(req.uri);
        if (match) {
            //console.log(req.uri, match);
            // console.log('recursive', req.uri, req.method, match.methods);
            var handler = match.methods[req.method] || match.methods.all;
            if (handler && handler.request_handler) {
                // Found a matching proxy handler. Prepare to call it.
                // Still using __proto__, as it's quite a bit faster than
                // Object.create.
                // jshint proto: true
                var childRESTBase = {
                    __proto__: self,
                    __parentReq: req,
                    __layer: i,
                    __depth:  (self.__depth || 0) + 1
                };
                childReq.params = match.params;
                return handler.request_handler(childRESTBase, childReq);
            }
        }
    }

    // No handler found.
    return Promise.resolve({
        status: 404,
        body: {
            type: 'not_found#proxy_handler',
            title: 'Not found.',
            uri: req.uri,
            method: req.method,
            level: i
        }
    });
};

// Generic parameter massaging:
// * If last parameter is an object, it is expected to be the request object.
// * If the first parameter is a string, it's expected to be the URL.
// * If the second parameter is a String or Buffer, it's expected to be a
//   resource body.
function makeRequest (args, method) {
    var argPos = args.length - 1,
        lastArg = args[argPos],
        req = {};
    if (lastArg && lastArg.constructor === Object) {
        req = lastArg;
        argPos--;
    }
    switch (argPos) {
    case 1: req.body = args[argPos]; argPos--;
            /* falls through */
    case 0: req.uri = args[argPos]; break;
    case -1: break;
    default: throw new Error('Invalid arguments supplied to Verb');
    }
    req.method = method;
    return req;
}

RESTBase.prototype.get = function get (uri, req) {
    return this.request(makeRequest(arguments, 'get'));
};

RESTBase.prototype.post = function post (uri, req) {
    return this.request(makeRequest(arguments, 'post'));
};

RESTBase.prototype.put = function put (uri, req) {
    return this.request(makeRequest(arguments, 'put'));
};

RESTBase.prototype.delete = function (uri, req) {
    return this.request(makeRequest(arguments, 'delete'));
};

RESTBase.prototype.head = function head (uri, req) {
    return this.request(makeRequest(arguments, 'head'));
};

RESTBase.prototype.options = function options (uri, req) {
    return this.request(makeRequest(arguments, 'options'));
};

RESTBase.prototype.trace = function trace (uri, req) {
    return this.request(makeRequest(arguments, 'trace'));
};

RESTBase.prototype.connect = function connect (uri, req) {
    return this.request(makeRequest(arguments, 'connect'));
};

RESTBase.prototype.copy = function copy (uri, req) {
    return this.request(makeRequest(arguments, 'copy'));
};

RESTBase.prototype.move = function move (uri, req) {
    return this.request(makeRequest(arguments, 'move'));
};

RESTBase.prototype.purge = function purge (uri, req) {
    return this.request(makeRequest(arguments, 'purge'));
};

module.exports = RESTBase;
