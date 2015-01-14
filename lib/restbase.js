'use strict';

/*
 * RESTBase request dispatcher and general shared per-request state namespace
 */

var rbUtil = require('./rbUtil');

function RESTBase (options, req) {
    if (options && options.constructor === RESTBase) {
        // Child instance
        var par = this._parent = options;
        this.log = par.log;
        this._recursionDepth = par._recursionDepth + 1;
        this._priv = par._priv;
    } else {
        // Brand new instance
        this.log = options.log; // logging method

        // Private
        this._parent = null;
        this._req = null;
        this._recursionDepth = 0;

        // Private state, shared with child instances
        this._priv = {
            options: options,
            router: options.router,
            statsd: null
        };

        // Configure monitoring
        var monitoring = options.conf.monitoring;
        if (monitoring) {
            this._priv.statsd = new rbUtil.StatsD(monitoring.statsdHost, monitoring.statsdPort);
        } else {
            this._priv.statsd = new rbUtil.StatsD();
        }
    }
}

// Make a child instance
RESTBase.prototype._makeChild = function(req) {
    var child = new RESTBase(this);
    // Remember the request that led to this child instance at each level, so
    // that we can provide nice error reporting and tracing.
    child._req = req;
    return child;
};


RESTBase.prototype.request = function (req) {
    if (req.method) {
        req.method = req.method.toLowerCase();
    }
    return this._request(req);
};

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

RESTBase.prototype._request = function (req) {
    var self = this;
    var priv = this._priv;
    if (this._recursionDepth > priv.options.maxDepth) {
        return Promise.resolve({
            status: 500,
            body: {
                type: 'request_recursion_depth_exceeded',
                title: 'RESTBase request recursion depth exceeded.',
                uri: req.uri,
                method: req.method,
                depth: this._recursionDepth
            }
        });
    }

    // Make sure we have a sane & uniform request object that doesn't change
    // (at least at the top level) under our feet.
    var childReq = cloneRequest(req);

    var match = priv.router.route(childReq.uri);
    if (match) {
        //console.log(req.uri, match);
        // console.log('recursive', req.uri, req.method, match.methods);


        var handler = match.methods[childReq.method] || match.methods.all;
        if (handler) {
            // TODO: check ACLs in the match object

            // TODO: make sure we set the path while building the tree in the
            // router!
            var statName = (match.path || match.sortKey) + "." + req.method.toUpperCase();

            // start timer
            self.statsd.startTimer(statName);

            // Prepare to call the handler with a child restbase instance
            var childRESTBase = this._makeChild(req);
            req.params = match.params;
            return handler(childRESTBase, childReq)
            .then(function(res){
                var statusClass = Math.floor(res.status / 100) + 'xx';
                self.statsd.stopTimer(statName, [statusClass, 'ALL']);
                self.log('trace', {
                    req: {
                        method: req.method,
                        uri: req.uri,
                    },
                    res: {
                        status: res.status
                    }
                });
                return res;
            },
            function(err){
                var statusClass = '5xx';
                if (err && err.status) {
                    statusClass = Math.floor(err.status / 100) + 'xx';
                }
                self.statsd.stopTimer(statName, [statusClass, 'ALL']);
                throw err;
            });
        }
    } else {
        // No handler found.
        return Promise.resolve({
            status: 404,
            body: {
                type: 'not_found#proxy_handler',
                title: 'Not found.',
                uri: req.uri,
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
function makeRequest (args, method) {
    var req;
    if (args.length === 1 && args[0].constructor === Object) {
        // fast path
        req = args[0];
        req.method = method;
        return req;
    }
    var argPos = args.length - 1;
    var lastArg = args[argPos];
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
    return this._request(makeRequest(arguments, 'get'));
};

RESTBase.prototype.post = function post (uri, req) {
    return this._request(makeRequest(arguments, 'post'));
};

RESTBase.prototype.put = function put (uri, req) {
    return this._request(makeRequest(arguments, 'put'));
};

RESTBase.prototype.delete = function (uri, req) {
    return this._request(makeRequest(arguments, 'delete'));
};

RESTBase.prototype.head = function head (uri, req) {
    return this._request(makeRequest(arguments, 'head'));
};

RESTBase.prototype.options = function options (uri, req) {
    return this._request(makeRequest(arguments, 'options'));
};

RESTBase.prototype.trace = function trace (uri, req) {
    return this._request(makeRequest(arguments, 'trace'));
};

RESTBase.prototype.connect = function connect (uri, req) {
    return this._request(makeRequest(arguments, 'connect'));
};

RESTBase.prototype.copy = function copy (uri, req) {
    return this._request(makeRequest(arguments, 'copy'));
};

RESTBase.prototype.move = function move (uri, req) {
    return this._request(makeRequest(arguments, 'move'));
};

RESTBase.prototype.purge = function purge (uri, req) {
    return this._request(makeRequest(arguments, 'purge'));
};

module.exports = RESTBase;
