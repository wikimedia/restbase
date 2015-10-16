'use strict';

// mocha defines to avoid JSHint breakage
/* global describe, it, before, beforeEach, after, afterEach */

var preq   = require('preq');
var assert = require('../../utils/assert.js');
var specs  = require('../../utils/specs.js');
var swaggerTest = require('swagger-test');
var server = require('../../utils/server.js');

    var prereqs = [
        { // transparently create HTML revision id 624484477
            method: 'get',
            uri: server.config.labsBucketURL + '/html/Foobar/252937',
            body: 'Hello there, this is revision 252937!'
        }
    ];

describe('swagger spec', function () {
    this.timeout(20000);

    before(function () { return server.start(); });

    var swaggerSpec = specs.get();
    swaggerSpec.host = server.config.hostPort;

    var xamples = swaggerTest.parse(swaggerSpec);

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

