'use strict';


var P = require('bluebird');
var HyperSwitch = require('hyperswitch');
var URI = HyperSwitch.URI;
var HTTPError = HyperSwitch.HTTPError;


var FORMATS = ['mml', 'svg', 'png'];


function MathoidService(options) {

    this.options = options;

}


MathoidService.prototype._invalidateCache = function(hyper, hash) {

    var routes = [];
    var uri = '//wikimedia.org/api/rest_v1/media/math/';

    routes.push(uri + 'formula/' + hash);

    FORMATS.forEach(function(fmt) {
        routes.push(uri + 'render/' + fmt + '/' + hash);
    });

    return hyper.post({
        uri: new URI(['wikimedia.org', 'sys', 'events', '']),
        body: routes.map(function(route) {
            return { meta: { uri: route } };
        })
    }).catch(function(e) {
        hyper.log('warn/bg-updates', e);
    });

};

MathoidService.prototype.getFormula = function(hyper, req) {

    var rp = req.params;
    var hash = rp.hash;

    return hyper.get({
        uri: new URI([rp.domain, 'sys', 'post_data', 'mathoid.input', hash])
    }).then(function(res) {
        res.headers['x-resource-location'] = hash;
        return res;
    }).catch({ status: 404 }, function() {
        // let's try to find an indirection
        return hyper.get({
            uri: new URI([rp.domain, 'sys', 'key_value', 'mathoid.hash_table', hash])
        }).then(function(hashRes) {
            // we have a normalised version of the formula
            hash = hashRes.body;
            // grab that version from storage
            return hyper.get({
                uri: new URI([rp.domain, 'sys', 'post_data', 'mathoid.input', hash])
            }).then(function(res) {
                res.headers['x-resource-location'] = hash;
                return res;
            });
        });
    });

};


MathoidService.prototype.checkInput = function(hyper, req) {

    var self = this;
    var rp = req.params;
    var hash;
    var origHash;
    var checkRes;

    // start by calculating the hash
    return hyper.post({
        uri: new URI([rp.domain, 'sys', 'post_data', 'mathoid.input', 'hash']),
        body: { q: req.body.q, type: rp.type }
    }).then(function(res) {
        hash = origHash = res.body;
        // short-circuit if it's a no-cache request
        if (req.headers && /no-cache/.test(req.headers['cache-control'])) {
            return P.reject(new HTTPError({ status: 404 }));
        }
        // check the post storage
        return hyper.get({
            uri: new URI([rp.domain, 'sys', 'key_value', 'mathoid.check', hash])
        }).catch({ status: 404 }, function() {
            // let's try to find an indirection
            return hyper.get({
                uri: new URI([rp.domain, 'sys', 'key_value', 'mathoid.hash_table', hash])
            }).then(function(hashRes) {
                // we have a normalised version of the formula
                hash = hashRes.body;
                // grab that version from storage
                return hyper.get({
                    uri: new URI([rp.domain, 'sys', 'key_value', 'mathoid.check', hash])
                });
            });
        });
    }).catch({ status: 404 }, function() {
        // if we are here, it means this is a new input formula
        // so call mathoid
        return hyper.post({
            uri: self.options.host + '/texvcinfo',
            headers: { 'content-type': 'application/json' },
            body: {
                q: req.body.q,
                type: rp.type
            }
        }).then(function(res) {
            checkRes = res;
            // store the normalised version
            return hyper.put({
                uri: new URI([rp.domain, 'sys', 'post_data', 'mathoid.input', '']),
                headers: { 'content-type': 'application/json' },
                body: {
                    q: res.body.checked,
                    type: rp.type
                }
            });
        }).then(function(res) {
            var indirectionP = P.resolve();
            hash = res.body;
            // add the indirection to the hash table if the hashes don't match
            if (hash !== origHash) {
                indirectionP = hyper.put({
                    uri: new URI([rp.domain, 'sys', 'key_value', 'mathoid.hash_table',
                        origHash]),
                    headers: { 'content-type': 'text/plain' },
                    body: hash
                });
            }
            // store the result
            checkRes.headers = {
                'content-type': 'application/json',
                'cache-control': 'no-cache',
                'x-resource-location': hash
            };
            return P.join(
                hyper.put({
                    uri: new URI([rp.domain, 'sys', 'key_value', 'mathoid.check', hash]),
                    headers: checkRes.headers,
                    body: checkRes.body
                }),
                indirectionP,
                self._invalidateCache.bind(self, hyper, hash),
                function() {
                    return checkRes;
                }
            );
        });
    });

};


MathoidService.prototype._storeRenders = function(hyper, domain, hash, completeBody) {

    var idx;
    var len = FORMATS.length;
    var reqs = new Array(len);

    for (idx = 0; idx < len; idx++) {
        var format = FORMATS[idx];
        // ensure that we have a proper response for a given format
        if (!completeBody[format] || !completeBody[format].headers || !completeBody[format].body) {
            return P.reject(new HTTPError({
                status: 500,
                body: {
                    type: 'server_error#empty_response',
                    description: 'Math: missing or malformed response for format ' + format
                }
            }));
        }
        // construct the request object that will be emitted
        var reqObj = {
            uri: new URI([domain, 'sys', 'key_value', 'mathoid.' + format, hash]),
            headers: Object.assign(
                completeBody[format].headers, { 'x-resource-location': hash }),
            body: completeBody[format].body
        };
        if (format === 'png' && reqObj.body && reqObj.body.type === 'Buffer') {
            // for png, we need to convert the encoded data manually
            // because we are receiving it wrapped inside a JSON
            reqObj.body = new Buffer(reqObj.body.data);
            completeBody[format].body = reqObj.body;
        }
        // store the emit Promise
        reqs[idx] = hyper.put(reqObj);
    }

    // invalidate the cache
    reqs.push(this._invalidateCache(hyper, hash));

    // now do them all
    return P.all(reqs).then(function() { return completeBody; });

};


MathoidService.prototype.requestAndStore = function(hyper, req) {

    var self = this;
    var rp = req.params;
    var hash = req.headers['x-resource-location'];

    // first ask for all the renders from Mathoid
    return hyper.post({
        uri: self.options.host + '/complete',
        headers: { 'content-type': 'application/json' },
        body: req.body
    }).then(function(res) {
        // now store all of the renders
        return self._storeRenders(hyper, rp.domain, hash, res.body);
    }).then(function(res) {
        // and return a proper response
        var ret = res[rp.format];
        ret.status = 200;
        Object.assign(ret.headers, { 'cache-control': self.options['cache-control'] });
        return ret;
    });

};


module.exports = function(options) {

    var mathoidSrv = new MathoidService(options);

    return {
        spec: {
            paths: {
                '/formula/{hash}': {
                    get: {
                        operationId: 'getFormula'
                    }
                },
                '/check/{type}': {
                    post: {
                        operationId: 'checkInput'
                    }
                },
                '/render/{format}': {
                    post: {
                        operationId: 'requestAndStore'
                    }
                }
            }
        },
        operations: {
            getFormula: mathoidSrv.getFormula.bind(mathoidSrv),
            checkInput: mathoidSrv.checkInput.bind(mathoidSrv),
            requestAndStore: mathoidSrv.requestAndStore.bind(mathoidSrv)
        },
        resources: [
            {
                uri: '/{domain}/sys/post_data/mathoid.input'
            }, {
                uri: '/{domain}/sys/key_value/mathoid.hash_table',
                body: { valueType: 'string' }
            }, {
                uri: '/{domain}/sys/key_value/mathoid.check',
                body: { valueType: 'json' }
            }
        ]
    };

};

