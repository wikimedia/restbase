"use strict";

// mocha defines to avoid JSHint breakage
/* global describe, it, before, beforeEach, after, afterEach */

var Router = require('../../../lib/router');
var assert = require('../utils/assert');

var fakeRestBase = { rb_config: {} };

// x-subspec and x-subspecs is no longer supported.
var faultySpec = {
    paths: {
        '/{domain:en.wikipedia.org}': {
            'x-subspecs': [],
            'x-subspec': {}
        }
    }
};

var additionalMethodSpec = {
    paths: {
        '/{domain:en.wikipedia.org}/v1': {
            'x-modules': {
                '/': [{
                    path: 'test/framework/router/subspec1.yaml'
                },
                    {
                        path: 'test/framework/router/subspec2.yaml'
                    }]
            }
        }
    }
};

var overlappingMethodSpec = {
    paths: {
        '/{domain:en.wikipedia.org}/v1': {
            'x-modules': {
                '/': [{
                    path: 'test/framework/router/subspec1.yaml'
                },
                    {
                        path: 'test/framework/router/subspec1.yaml'
                    }]
            }
        }
    }
};


var nestedSecuritySpec = {
    paths: {
        '/{domain:en.wikipedia.org}/v1': {
            'x-modules': {
                '/': [{
                    path: 'test/framework/router/secure_subspec.yaml'
                }]
            },
            security: ['first']
        }
    }
};

describe('Router', function() {

    it('should fail loading a faulty spec', function() {
        var router = new Router();
        return router.loadSpec(faultySpec, fakeRestBase)
        .then(function() {
            throw new Error("Should throw an exception!");
        },
        function() {
            // exception thrown as expected
        });
    });

    it('should allow adding methods to existing paths', function() {
        var router = new Router();
        return router.loadSpec(additionalMethodSpec, fakeRestBase)
        .then(function() {
            var handler = router.route('/en.wikipedia.org/v1/page/Foo/html');
            assert.deepEqual(!!handler.value.methods.get, true);
            assert.deepEqual(!!handler.value.methods.post, true);
        });
    });

    it('should error on overlapping methods on the same path', function() {
        var router = new Router();
        return router.loadSpec(overlappingMethodSpec)
        .then(function() {
            throw new Error("Should throw an exception!");
        },
        function() {
            // exception thrown as expected
        });
    });

    it('should pass permission along the path to endpoint', function() {
        var router = new Router();
        return router.loadSpec(nestedSecuritySpec, fakeRestBase)
        .then(function() {
            var handler = router.route('/en.wikipedia.org/v1/page/secure');
            assert.deepEqual(handler.permissions, [
                { value: 'first' },
                { value: 'second'},
                { value: 'third' },
                { value: 'fourth', method: 'get' }
            ]);
        });
    });
});