'use strict';

// mocha defines to avoid JSHint breakage
/* global describe, it, before, beforeEach, after, afterEach */

var assert = require('../utils/assert.js');
var server = require('../utils/server.js');
var preq   = require('preq');
var P = require('bluebird');
var simple_service = require('../../mods/simple_service');

describe('simple_service', function () {
    this.timeout(20000);

    before(function () { return server.start(); });

    // A test page that includes the current date, so that it changes if
    // re-rendered more than a second apart.
    var testPage = server.config.baseURL + '/service/test/User:GWicke%2fDate';

    function hasTextContentType(res) {
        assert.contentType(res, 'text/html');
    }

    var slice;

    it('retrieve content from backend service', function () {
        var tid1;
        var tid2;
        return preq.get({
            uri: testPage
        })
        .then(function (res) {
            assert.deepEqual(res.status, 200);
            tid1 = res.headers.etag;
            hasTextContentType(res);

            // Delay for 1s to make sure that the content differs on
            // re-render, then force a re-render and check that it happened.
            slice = server.config.logStream.slice();
            return P.delay(1100)
            .then(function() {
                return preq.get({
                    uri: testPage,
                    headers: { 'cache-control': 'no-cache' }
                });
            });
        })
        .then(function (res) {
            tid2 = res.headers.etag;
            assert.notDeepEqual(tid2, tid1);
            assert.notDeepEqual(tid2, undefined);
            hasTextContentType(res);
            slice.halt();
            assert.remoteRequests(slice, true);
            // delay for 1s to let the content change on re-render
            slice = server.config.logStream.slice();

            // Check retrieval of a stored render
            return P.delay(1100)
            .then(function() {
                return preq.get({
                    uri: testPage,
                });
            });
        })
        .then(function (res) {
            var tid3 = res.headers.etag;
            assert.deepEqual(tid3, tid2);
            assert.notDeepEqual(tid3, undefined);
            // Check that there were no remote requests
            slice.halt();
            assert.remoteRequests(slice, false);
            hasTextContentType(res);
        });
    });

    it('validates config: checks parallel returning requests', function() {
        return P.try(function() {
            simple_service({
                paths: {
                    test_path: {
                        get: {
                            on_request: [
                                {
                                    get_one: {
                                        request: {
                                            uri: 'http://en.wikipedia.org/wiki/One'
                                        },
                                        return: '{$.get_one}'
                                    },
                                    get_two: {
                                        request: {
                                            uri: 'http://en.wikipedia.org/wiki/Two'
                                        },
                                        return: '{$.get_two}'
                                    }
                                }
                            ]
                        }
                    }
                }
            })
        })
        .then(function() {
            throw new Error('Should throw error');
        })
        .catch(function(e) {
            assert.deepEqual(e.message !== 'Should throw error', true);
        })
    });

    it('validates config: requires either return or request', function() {
        return P.try(function() {
            simple_service({
                paths: {
                    test_path: {
                        get: {
                            on_request: [
                                {
                                    get_one: {}
                                }
                            ]
                        }
                    }
                }
            })
        })
        .then(function() {
            throw new Error('Should throw error');
        })
        .catch(function(e) {
            assert.deepEqual(e.message !== 'Should throw error', true);
        })
    });

    it('validates config: requires request for return_if', function() {
        return P.try(function() {
            simple_service({
                paths: {
                    test_path: {
                        get: {
                            on_request: [
                                {
                                    get_one: {
                                        return_if: {
                                            status: '5xx'
                                        }
                                    }
                                }
                            ]
                        }
                    }
                }
            })
        })
        .then(function() {
            throw new Error('Should throw error');
        })
        .catch(function(e) {
            assert.deepEqual(e.message !== 'Should throw error', true);
        })
    });

    it('validates config: requires request for catch', function() {
        return P.try(function() {
            simple_service({
                paths: {
                    test_path: {
                        get: {
                            on_request: [
                                {
                                    get_one: {
                                        catch: {
                                            status: '5xx'
                                        }
                                    }
                                }
                            ]
                        }
                    }
                }
            })
        })
        .then(function() {
            throw new Error('Should throw error');
        })
        .catch(function(e) {
            assert.deepEqual(e.message !== 'Should throw error', true);
        })
    });

    it('Performs parallel requests', function() {
        var testPage = server.config.baseURL + '/service/test_parallel/User:GWicke%2fDate/User:GWicke%2fDate';
        return preq.get({
            uri: testPage
        })
        .then(function(result) {
            assert.deepEqual(result.body.first.status, 200);
            assert.deepEqual(result.body.second.status, 200);
            assert.deepEqual(result.body.first.headers['content-type'], 'text/html');
            assert.deepEqual(result.body.second.headers['content-type'], 'text/html');
        })
    });

});
