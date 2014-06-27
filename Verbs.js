"use strict";

/*
 * if URI maps to the same route: call backend handler, return promise
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

Verbs.prototype.GET = function* GET (uri, req) {
    if (uri && uri.constructor === String) {
        if (req) {
            req.uri = uri;
            req.method = 'get';
        } else {
            req = {
                uri: uri,
                method: 'get'
            };
        }
    } else {
        req = uri;
    }
    return yield* this.request(req);
};

module.exports = Verbs;
