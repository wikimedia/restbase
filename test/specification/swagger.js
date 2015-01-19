'use strict';

// mocha defines to avoid JSHint breakage
/* global describe, it, before, beforeEach, after, afterEach */

var server = require('../utils/server.js');
var assert = require('../utils/assert.js');
var preq   = require('preq');
var specs  = require('../utils/specs.js');

var prereqs = [
    { // create the domain
        method: 'put',
        uri: server.config.hostPort + '/v1/en.wikipedia.test.local',
        headers: { 'content-type': 'application/json' },
        body: {},
    },
    { // create the bucket
        method: 'put',
        uri: server.config.bucketURL,
        headers: { 'content-type': 'application/json' },
        body: { type: 'pagecontent' },
    },
    { // transparently create HTML revision id 624484477
        method: 'get',
        uri: server.config.bucketURL + '/Foobar/html/624484477',
        body: 'Hello there, this is revision 624484477!'
    },
    { // create an html revision of Foobar
        method: 'put',
        uri: server.config.bucketURL + '/Foobar/html/76f22880-362c-11e4-9234-0123456789ab',
        body: 'Hello there, this is revision 76f22880-362c-11e4-9234-0123456789ab!',
    },
    { // create an html revision of Foobar
        method: 'put',
        uri: server.config.bucketURL + '/Foobar/html/9843f080-3443-11e4-9234-0123456789ab',
        body: 'Hello there, this is revision 9843f080-3443-11e4-9234-0123456789ab!',
    },
    { // create an html revision of Foobar
        method: 'put',
        uri: server.config.bucketURL + '/Foobar/html/b9f3f880-8153-11e4-9234-0123456789ab',
        body: 'Hello there, this is revision b9f3f880-8153-11e4-9234-0123456789ab!',
    },
];

describe('swagger spec', function () {
    this.timeout(20000);

    before(function () { return server.start(); });

    var xamples = specs.parseXamples(specs.get(), server.config.hostPort);

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
            return preq[xample.request.method](xample.request)
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
