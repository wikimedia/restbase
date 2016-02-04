"use strict";

// mocha defines to avoid JSHint breakage
/* global describe, it, before, beforeEach, after, afterEach */

var Router = require('../../../lib/router');
var assert = require('../utils/assert');
var fs     = require('fs');
var yaml   = require('js-yaml');

var fakeHyperSwitch = { config: {} };

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

var noHandlerSpec = {
    paths: {
        '/test': {
            get: {
                operationId: 'unknown'
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
        var router = new Router({
            appBasePath: __dirname + '/../../..'
        });
        return router.loadSpec(faultySpec, fakeHyperSwitch)
        .then(function() {
            throw new Error("Should throw an exception!");
        },
        function(e) {
            assert.deepEqual(e.message,
                'x-subspec and x-subspecs is no longer supported! Use x-modules instead.');
        });
    });

    it('should allow adding methods to existing paths', function() {
        var router = new Router({
            appBasePath: __dirname + '/../../..'
        });
        return router.loadSpec(additionalMethodSpec, fakeHyperSwitch)
        .then(function() {
            var handler = router.route('/en.wikipedia.org/v1/page/Foo/html');
            assert.deepEqual(!!handler.value.methods.get, true);
            assert.deepEqual(!!handler.value.methods.post, true);
        });
    });

    it('should error on overlapping methods on the same path', function() {
        var router = new Router({
            appBasePath: __dirname + '/../../..'
        });
        return router.loadSpec(overlappingMethodSpec, fakeHyperSwitch)
        .then(function() {
            throw new Error("Should throw an exception!");
        },
        function(e) {
            assert.deepEqual(/^Trying to re-define existing metho/.test(e.message), true);
        });
    });

    it('should pass permission along the path to endpoint', function() {
        var router = new Router({
            appBasePath: __dirname + '/../../..'
        });
        return router.loadSpec(nestedSecuritySpec, fakeHyperSwitch)
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
    it('should fail when no handler found for method', function() {
        var router = new Router({
            appBasePath: __dirname + '/../../..'
        });
        return router.loadSpec(noHandlerSpec, fakeHyperSwitch)
        .then(function() {
            throw new Error("Should throw an exception!");
        },
        function(e) {
            assert.deepEqual(e.message,
                'No known handler associated with operationId unknown');
        });
    });

    it('should not modify top-level spec-root', function() {
        var spec = yaml.safeLoad(fs.readFileSync(__dirname + '/multi_domain_spec.yaml'));
        var router = new Router({
            appBasePath: __dirname + '/../../..'
        });
        return router.loadSpec(spec, fakeHyperSwitch)
        .then(function() {
            var node = router.route('/test2');
            assert.deepEqual(node.value.path, '/test2');
        });
    });
});