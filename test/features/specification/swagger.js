'use strict';

// mocha defines to avoid JSHint breakage
/* global describe, it, before, beforeEach, after, afterEach */

var preq   = require('preq');
var assert = require('../../utils/assert.js');
var specs  = require('../../utils/specs.js');

module.exports = function (config) {

    var prereqs = [
        { // transparently create HTML revision id 624484477
            method: 'get',
            uri: config.bucketURL + '/Foobar/html/624484477',
            body: 'Hello there, this is revision 624484477!'
        }
    ];

    describe('swagger spec', function () {
        var xamples = specs.parseXamples(specs.get(), config.hostPort);

        it('should run ' + prereqs.length + ' idempotent prerequisites', function() {
            var count = 0;
            var reqChain = prereqs.map(function (req) {
                return function () {
                    return preq[req.method](req)
                    .then(function (res) {
                        count = count + 1;
                        return res;
                    });
                };
            })
            .reduce(function (f1, f2) {
                return function () { return f1().then(f2); };
            });
            return reqChain()
            .then(function () {
                assert.deepEqual(count, prereqs.length, 'only ran ' + count);
            });
        });

        xamples.forEach(function (xample) {
            it(xample.description, function() {
                return preq[xample.request.method](xample.request)
                .then(function (res) {
                    assert.isSuperset(res, xample.response);
                    return res;
                });
            });
        });

    });

};
