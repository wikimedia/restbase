'use strict';


var assert = require('../utils/assert.js');
var server = require('../utils/server.js');
var preq   = require('preq');
var P = require('bluebird');


describe('Mathoid', function() {

    var f = 'c^2 = a^2 + b^2';
    var nf = 'c^{2}=a^{2}+b^{2}';
    var uri = server.config.hostPort + '/wikimedia.org/v1/media/math';
    var formats = ['mml', 'svg', 'png'];
    var hash;

    this.timeout(20000);

    before(function () { return server.start(); });

    it('checks the formula with Mathoid', function() {
        var slice = server.config.logStream.slice();
        return preq.post({
            uri: uri + '/check/tex',
            headers: { 'content-type': 'application/json' },
            body: { q: f }
        }).then(function(res) {
            slice.halt();
            hash = res.headers['x-resource-location'];
            assert.localRequests(slice, false);
            assert.remoteRequests(slice, true);
            assert.checkString(res.headers['cache-control'], 'no-cache');
        });
    });

    it('retrieves the check output from storage', function() {
        var slice = server.config.logStream.slice();
        return preq.post({
            uri: uri + '/check/tex',
            headers: { 'content-type': 'application/json' },
            body: { q: f }
        }).then(function(res) {
            slice.halt();
            assert.localRequests(slice, true);
            assert.remoteRequests(slice, false);
            assert.checkString(res.headers['cache-control'], 'no-cache');
        });
    });

    it('retrieves the check output of the normalised version', function() {
        var slice = server.config.logStream.slice();
        return preq.post({
            uri: uri + '/check/tex',
            headers: { 'content-type': 'application/json' },
            body: { q: nf }
        }).then(function(res) {
            slice.halt();
            assert.localRequests(slice, true);
            assert.remoteRequests(slice, false);
            assert.checkString(res.headers['cache-control'], 'no-cache');
        });
    });

    it('ignores stored version for no-cache', function() {
        var slice = server.config.logStream.slice();
        return preq.post({
            uri: uri + '/check/tex',
            headers: {
                'content-type': 'application/json',
                'cache-control': 'no-cache'
            },
            body: { q: f }
        }).then(function(res) {
            slice.halt();
            assert.localRequests(slice, false);
            assert.remoteRequests(slice, true);
            assert.checkString(res.headers['cache-control'], 'no-cache');
        });
    });

    it('gets the formula from storage', function() {
        return preq.get({
            uri: uri + '/formula/' + hash
        }).then(function(res) {
            assert.deepEqual(res.status, 200);
            assert.checkString(res.headers['x-resource-location'], hash);
            assert.ok(res.body);
        });
    });

    for (var i = 0; i < formats.length; i++) {
        var format = formats[i];
        it('gets the render in ' + format, function() {
            return preq.get({
                uri: uri + '/render/' + format + '/' + hash
            }).then(function(res) {
                assert.checkString(res.headers['content-type'], new RegExp(format));
                assert.ok(res.body);
            });
        });
    }

});
