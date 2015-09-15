'use strict';

// mocha defines to avoid JSHint breakage
/* global describe, it, before, beforeEach, after, afterEach */

var assert = require('../../utils/assert.js');
var preq   = require('preq');
var server = require('../../utils/server.js');
var Template = require('../../../lib/reqTemplate.js');
var URI = require('swagger-router').URI;
var nock   = require('nock');

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
                    'one': {
                        'two': {
                            'tree': '{a.b.c}'
                        }
                    }
                },
                'field_name_with_underscore': '{field_name_with_underscore}',
                'additional_context_field': '{$.additional_context.field}',
                'string_templated': 'test {field_name_with_underscore}'
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
                },
                'field_name_with_underscore': 'field_value_with_underscore'
            }
        };
        var expectedTemplatedRequest = {
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
                    'one': {
                        'two': {
                            'tree': 'nestedValue'
                        }
                    }
                },
                'field_name_with_underscore': 'field_value_with_underscore',
                additional_context_field: 'additional_test_value',
                'string_templated': 'test field_value_with_underscore'
            }
        };
        var result = new Template(requestTemplate).eval({
            request: testRequest,
            additional_context: {
                field: 'additional_test_value'
            }
        });
        assert.deepEqual(result, expectedTemplatedRequest);
    });

    it('should encode uri components', function() {
        var requestTemplate = {
            uri: 'http://{domain}/path1/{path2}'
        };
        var result = new Template(requestTemplate).eval({
            request: {
                params: {
                    domain: 'en.wikipedia.org',
                    path2: 'test1/test2/test3'
                }
            }
        });
        assert.deepEqual(result.uri,
            new URI('http://en.wikipedia.org/path1/{path2}', {}, true).expand({
                path2: 'test1/test2/test3'
        }));
    });

    it('should support optional path elements in uri template', function() {
        var requestTemplate = {
            uri: '/{domain}/path1{/optional}'
        };
        var resultNoOptional = new Template(requestTemplate).eval({
            request: {
                params: {
                    domain: 'en.wikipedia.org'
                }
            }
        });
        assert.deepEqual(resultNoOptional.uri, new URI('/en.wikipedia.org/path1{/optional}', {}, true).expand());
        var resultWithOptional = new Template(requestTemplate).eval({
            request: {
                params: {
                    domain: 'en.wikipedia.org',
                    optional: 'value'
                }
            }
        });
        assert.deepEqual(resultWithOptional.uri, new URI('/en.wikipedia.org/path1{/optional}', {}, true).expand({
            optional: 'value'
        }));
    });

    it('should support + templates in path', function() {
        var requestTemplate = {
            uri: 'http://{domain}/path1/{+path}'
        };
        var result = new Template(requestTemplate).eval({
            request: {
                params: {
                    domain: 'en.wikipedia.org',
                    path: 'test1/test2/test3'
                }
            }
        });
        assert.deepEqual(result.uri,
            new URI('http://en.wikipedia.org/path1/{+path}', {}, true).expand({
            path: 'test1/test2/test3'
        }));
    });

    it('should support templating the whole uri', function() {
        var requestTemplate = {
            uri: '{uri}'
        };
        var result = new Template(requestTemplate).eval({
            request: {
                params: {
                    uri: 'en.wikipedia.org/path1/test1/test2/test3'
                }
            }
        });
        assert.deepEqual(result.uri, new URI('en.wikipedia.org/path1/test1/test2/test3', {}, false));
    });

    it('should truncate body upon HEAD request', function() {
        return preq.head({
            uri: server.config.bucketURL + '/html/1912'
        })
        .then(function(res) {
            assert.deepEqual(res.status, 200);
            assert.deepEqual(res.headers['content-length'], undefined);
            assert.deepEqual(res.body, '');
        })
    })

    it('absolute templates in URI', function() {
        var template = new Template({
            uri: '/path/{$.request.headers.host}/{$.request.body}'
        });
        var request = {
            method: 'post',
            headers: {
                'host': 'test'
            },
            body: 'a'
        };
        assert.deepEqual(template.eval({request:request}).uri, '/path/test/a');
    });

});
