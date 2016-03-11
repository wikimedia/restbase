'use strict';


var P = require('bluebird');
var HyperSwitch = require('hyperswitch');
var URI = HyperSwitch.URI;
var HTTPError = HyperSwitch.HTTPError;


function MathoidService(options) {

    this.options = options;

}


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
        }).catch({ status: 404 }, function(err) {
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
    }).then(function(res) {
        // we have a record, return that
        res.headers['cache-control'] = self.options['cache-control'];
        return res;
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
                    uri: new URI([rp.domain, 'sys', 'key_value', 'mathoid.hash_table', origHash]),
                    headers: { 'content-type': 'text/plain' },
                    body: hash
                });
            }
            // store the result
            checkRes.headers = {
                'content-type': 'application/json',
                'x-resource-location': hash
            };
            return P.all([
                hyper.put({
                    uri: new URI([rp.domain, 'sys', 'key_value', 'mathoid.check', hash]),
                    headers: checkRes.headers,
                    body: checkRes.body
                }),
                indirectionP
            ]);
        }).then(function() {
            checkRes.headers['cache-control'] = self.options['cache-control'];
            return checkRes;
        });
    });

};


module.exports = function(options) {

    var mathoidSrv = new MathoidService(options);

    return {
        spec: {
            paths: {
                '/check/{type}': {
                    post: {
                        operationId: 'checkInput'
                    }
                }
            }
        },
        operations: {
            checkInput: mathoidSrv.checkInput.bind(mathoidSrv)
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

