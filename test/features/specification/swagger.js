'use strict';

// mocha defines to avoid JSHint breakage
/* global describe, it, before, beforeEach, after, afterEach */

var preq   = require('preq');
var assert = require('../../utils/assert.js');
var specs  = require('../../utils/specs.js');

module.exports = function (config) {

    // Wrap an HTTP request in a continuation
    function requestK(req) {
        return function () {
            return preq[req.method](req);
        };
    }

    var specUrl = 'http://wikimedia.github.io/restbase/v1/swagger.yaml';

    describe('swagger spec', function () {
        this.timeout(20000);
        var xamples = [];

        it('should provide testable x-amples', function (done) {
            specs.getSpec(specUrl, function (spec) {
                xamples = specs.parseXamples(spec, config.hostPort);
                var expected = xamples.length;
                var actual = 0;
                xamples.reduce(
                    function (p, xample) {
                        return p.then(function () {
                            // Chain the prerequesites in order
                            return xample.prereqs.reduce(function (p, prereq) {
                                return p.then(requestK(prereq));
                            }, Promise.resolve(true))
                            // Fire off the main request
                            .then(requestK(xample.request))
                            // Validate the response
                            .then(function (res) {
                                assert.isSuperset(res, xample.response);
                                actual = actual + 1;
                            });
                        });
                    },
                    Promise.resolve(true)
                ).then(function () {
                    assert.deepEqual(actual, expected);
                    done();
                });
            });
        });
    });

};
