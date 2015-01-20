'use strict';

// mocha defines to avoid JSHint breakage
/* global describe, it, before, beforeEach, after, afterEach */

var preq   = require('preq');
var assert = require('../../utils/assert.js');
var specs  = require('../../utils/specs.js');

module.exports = function (config) {

    var prereqs = [
        { // create the domain
            method: 'put',
            uri: config.hostPort + '/v1/en.wikipedia.test.local',
            headers: { 'content-type': 'application/json' },
            body: {},
        },
        { // create the bucket
            method: 'put',
            uri: config.bucketURL,
            headers: { 'content-type': 'application/json' },
            body: { type: 'pagecontent' },
        },
        { // transparently create HTML revision id 624484477
            method: 'get',
            uri: config.bucketURL + '/Foobar/html/624484477',
            body: 'Hello there, this is revision 624484477!'
        },
        { // create an html revision of Foobar
            method: 'put',
            uri: config.bucketURL + '/Foobar/html/76f22880-362c-11e4-9234-0123456789ab',
            body: 'Hello there, this is revision 76f22880-362c-11e4-9234-0123456789ab!',
        },
        { // create an html revision of Foobar
            method: 'put',
            uri: config.bucketURL + '/Foobar/html/9843f080-3443-11e4-9234-0123456789ab',
            body: 'Hello there, this is revision 9843f080-3443-11e4-9234-0123456789ab!',
        },
        { // create an html revision of Foobar
            method: 'put',
            uri: config.bucketURL + '/Foobar/html/b9f3f880-8153-11e4-9234-0123456789ab',
            body: 'Hello there, this is revision b9f3f880-8153-11e4-9234-0123456789ab!',
        },
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

        var xamplesRun = 0;
        xamples.forEach(function (xample) {
            it(xample.description, function() {
                return preq.options({ uri: xample.request.uri })
                .then(function (res) {
                  assert.deepEqual(res.status, 200);
                  assert.deepEqual(res.headers['access-control-allow-origin'], '*');
                  assert.deepEqual(res.headers['access-control-allow-methods'], 'GET');
                  assert.deepEqual(res.headers['access-control-allow-headers'], 'accept, content-type');
                  return preq[xample.request.method](xample.request);
                })
                .then(function (res) {
                    assert.isSuperset(res, xample.response);
                    xamplesRun = xamplesRun + 1;
                    return res;
                });
            });
        });

        it('should have run ' + xamples.length + ' xamples', function() {
            assert.deepEqual(xamplesRun, xamples.length);
        });

    });

};
