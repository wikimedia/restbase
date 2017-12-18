'use strict';

// mocha defines to avoid JSHint breakage
/* global describe, it, before, beforeEach, after, afterEach */

var assert = require('../../utils/assert.js');
var preq   = require('preq');
var server = require('../../utils/server.js');

describe('router - misc', function() {

    this.timeout(20000);

    before(function () { return server.start(); });

    it('should deny access to /{domain}/sys', function() {
        return preq.get({
            uri: server.config.hostPort + '/en.wikipedia.org/sys/table3'
        }).catch(function(err) {
            assert.deepEqual(err.status, 403);
        });
    });

    it('should set a request ID for each sub-request and return it', function() {
        var slice = server.config.logStream.slice();
        return preq.get({
            uri: server.config.labsBucketURL + '/html/Foobar',
            headers: {
                'Cache-Control': 'no-cache'
            }
        })
        .delay(1000)
        .then(function(res) {
            slice.halt();
            var reqId = res.headers['x-request-id'];
            assert.notDeepEqual(reqId, undefined, 'Request ID not returned');
            slice.get().forEach(function(line) {
                var a = JSON.parse(line);
                if(a.req || a.request_id) {
                    assert.deepEqual(a.request_id, reqId, 'Request ID mismatch');
                }
            });
        });
    });

    it('should honour the provided request ID', function() {
        var reqId = 'b6c17ea83d634b31bb28d60aae1caaac';
        var slice = server.config.logStream.slice();
        return preq.get({
            uri: server.config.labsBucketURL + '/html/Foobar',
            headers: {
                'X-Request-Id': reqId
            }
        }).then(function(res) {
            slice.halt();
            assert.deepEqual(res.headers['x-request-id'], reqId, 'Returned request ID does not match the sent one');
            slice.get().forEach(function(line) {
                var a = JSON.parse(line);
                if (a.req || a.request_id) {
                    assert.deepEqual(a.request_id, reqId, 'Request ID mismatch');
                }
            });
        });
    });

    it('should log the request ID for a 404', function() {
        var reqId = '9c54ff673d634b31bb28d60aae1cb43c';
        var slice = server.config.logStream.slice();
        return preq.get({
            uri: server.config.labsBucketURL + '/foo-bucket/Foobar',
            headers: {
                'X-Request-Id': reqId
            }
        }).then(function(res) {
            slice.halt();
            throw new Error('Expected a 404, got ' + res.status);
        }, function(err) {
            slice.halt();
            assert.deepEqual(err.headers['x-request-id'], reqId, 'Returned request ID does not match the sent one');
            slice.get().forEach(function(line) {
                var a = JSON.parse(line);
                if (a.req || a.request_id) {
                    assert.deepEqual(a.request_id, reqId, 'Request ID mismatch');
                }
            });
        });
    });

    it('should truncate body upon HEAD request', function() {
        return preq.head({
            uri: server.config.labsBucketURL + '/html/Foobar'
        })
        .then(function(res) {
            assert.deepEqual(res.status, 200);
            assert.deepEqual(res.headers['content-length'], undefined);
            assert.deepEqual(res.body, '');
        });
    });
});
