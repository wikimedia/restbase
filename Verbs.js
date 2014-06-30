"use strict";

/*
 * If URI maps to the same route: call backend handler, return promise
 * else: call front-end handler, return promise
 *
 * Need access to {
 *      - front-end router
 *      - back-end router
 * }
 */

function Verbs (route, env, frontEndRouter, backEndRouter) {
    this.route = route;
    this.env = env;
    this.frontEndRouter = frontEndRouter;
    this.backEndRouter = backEndRouter;
}

Verbs.prototype.request = function* request (req) {
    var frontEndMatch = this.frontEndRouter.match(req.uri),
        handler, res;
    if (!frontEndMatch || frontEndMatch.route === this.route) {
        // No front-end handler, or matches the same route.
        // Point to backend.
        //console.log('trying backend for', req.uri);
        var backendMatch = this.backEndRouter.match(req.uri);
        if (!backendMatch) {
            return {
                status: 404,
            };
        }
        handler = backendMatch.route.methods[req.method]
                    || backendMatch.route.methods.all;
        res = yield* handler.handler(this, req);
    } else {
        // call the frount-end route
        handler = frontEndMatch.route.methods[req.method]
                    || frontEndMatch.route.methods.all ;
        if (handler) {
            if (this.route === null) {
                this.route = frontEndMatch.route;
            }
            res = yield *handler.handler(this, req);
        } else {
            throw new Error('No handler found for ' + req.method + ' ' + req.uri);
        }
    }
    return res;
};

function makeRequest (args, method) {
    var argPos = args.length - 1,
        lastArg = args[argPos],
        req = {};
    if (lastArg && lastArg.constructor === Object) {
        req = lastArg;
        argPos--;
    }
    switch (argPos) {
    case 1: req.body = args[argPos]; argPos--; // fall through
    case 0: req.uri = args[argPos]; break;
    case -1: break;
    default: throw new Error('Invalid arguments supplied to Verb');
    }
    req.method = method;
    return req;
}

Verbs.prototype.GET = function* GET (uri, req) {
    return yield* this.request(makeRequest(arguments, 'get'));
};

Verbs.prototype.POST = function* POST (uri, req) {
    return yield* this.request(makeRequest(arguments, 'put'));
};

Verbs.prototype.PUT = function* PUT (uri, req) {
    return yield* this.request(makeRequest(arguments, 'put'));
};

Verbs.prototype.DELETE = function* DELETE (uri, req) {
    return yield* this.request(makeRequest(arguments, 'put'));
};

Verbs.prototype.HEAD = function* HEAD (uri, req) {
    return yield* this.request(makeRequest(arguments, 'head'));
};

Verbs.prototype.OPTIONS = function* OPTIONS (uri, req) {
    return yield* this.request(makeRequest(arguments, 'options'));
};

Verbs.prototype.TRACE = function* TRACE (uri, req) {
    return yield* this.request(makeRequest(arguments, 'trace'));
};

Verbs.prototype.CONNECT = function* CONNECT (uri, req) {
    return yield* this.request(makeRequest(arguments, 'connect'));
};

Verbs.prototype.COPY = function* COPY (uri, req) {
    return yield* this.request(makeRequest(arguments, 'copy'));
};

Verbs.prototype.MOVE = function* MOVE (uri, req) {
    return yield* this.request(makeRequest(arguments, 'move'));
};

Verbs.prototype.PURGE = function* PURGE (uri, req) {
    return yield* this.request(makeRequest(arguments, 'purge'));
};

module.exports = Verbs;
