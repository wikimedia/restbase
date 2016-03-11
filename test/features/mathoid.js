'use strict';


var assert = require('../utils/assert.js');
var server = require('../utils/server.js');
var preq   = require('preq');
var P = require('bluebird');


describe('Mathoid', function() {

    var f = 'c^2 = a^2 + b^2';
    var nf = 'c^{2}=a^{2}+b^{2}';
    var uri = server.config.hostPort + '/wikimedia.org/v1/media/math';

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
            assert.localRequests(slice, false);
            assert.remoteRequests(slice, true);
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
        });
    });

});
