'use strict';

// mocha defines to avoid JSHint breakage
/* global describe, it, before, beforeEach, after, afterEach */

var assert = require('../../utils/assert.js');
var preq   = require('preq');
var server = require('../../utils/server.js');
var Template = require('../../../lib/reqTemplate.js');
var URI = require('swagger-router').URI;

describe('router - misc', function() {

    this.timeout(20000);

    before(function () { return server.start(); });

    it('should deny access to /{domain}/sys', function() {
        return preq.get({
            uri: server.config.hostPort + '/en.wikipedia.org/sys/table'
        }).catch(function(err) {
            assert.deepEqual(err.status, 403);
        });
    });

    it('should set a request ID for each sub-request and return it', function() {
        var slice = server.config.logStream.slice();
        return preq.get({
            uri: server.config.bucketURL + '/html/Foobar',
            headers: {
                'Cache-Control': 'no-cache'
            }
        }).then(function(res) {
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
            uri: server.config.bucketURL + '/html/Foobar',
            headers: {
                'X-Request-Id': reqId
            }
        }).then(function(res) {
            slice.halt();
            assert.deepEqual(res.headers['x-request-id'], reqId, 'Returned request ID does not match the sent one');
            slice.get().forEach(function(line) {
                var a = JSON.parse(line);
                if(a.req || a.request_id) {
                    assert.deepEqual(a.request_id, reqId, 'Request ID mismatch');
                }
            });
        });
    });

    it('should log the request ID for a 404', function() {
        var reqId = '9c54ff673d634b31bb28d60aae1cb43c';
        var slice = server.config.logStream.slice();
        return preq.get({
            uri: server.config.bucketURL + '/foo-bucket/Foobar',
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
                if(a.req || a.request_id) {
                    assert.deepEqual(a.request_id, reqId, 'Request ID mismatch');
                }
            });
        });
    });

    it('should correctly resolve request templates', function() {
        var requestTemplate = {
            uri: '/{domain}/test',
            method: 'post',
            headers: {
                'name-with-dashes': '{name-with-dashes}',
                'global-header': '{$.request.params.domain}',
                'added-string-header': 'added-string-header'
            },
            query: {
                'simple': '{simple}',
                'added': 'addedValue',
                'global': '{$.request.headers.name-with-dashes}'
            },
            body: {
                'object': '{object}',
                'global': '{$.request.params.domain}',
                'added': 'addedValue',
                'nested': {
                    'a': {
                        'b': {
                            c: '{a.b.c}'
                        }
                    }
                }
            }
        };
        var testRequest = {
            params: {
                'domain': 'testDomain'
            },
            method: 'get',
            headers: {
                'name-with-dashes': 'name-with-dashes-value',
                'removed-header': 'this-will-be-removed'
            },
            query: {
                'simple': 'simpleValue',
                'removed': 'this-will-be-removed'
            },
            body: {
                'object': {
                    'testField': 'testValue'
                },
                'removed': {
                    'field': 'this-will-be-removed'
                },
                'a': {
                    'b': {
                        'c': 'nestedValue'
                    }
                }
            }
        };
        var expectedTemplatedRequest = {
            params: {
                'domain': 'testDomain'
            },
            uri: new URI('testDomain/test'),
            method: 'post',
            headers: {
                'name-with-dashes': 'name-with-dashes-value',
                'global-header': 'testDomain',
                'added-string-header': 'added-string-header'
            },
            query: {
                'simple': 'simpleValue',
                'added': 'addedValue',
                'global': 'name-with-dashes-value'
            },
            body: {
                'object': {
                    'testField': 'testValue'
                },
                'global': 'testDomain',
                'added': 'addedValue',
                'nested': {
                    'a': {
                        b: {
                            c: 'nestedValue'
                        }
                    }
                }
            }
        };
        var result = new Template(requestTemplate).eval(testRequest);
        assert.deepEqual(result, expectedTemplatedRequest);
    });
});
