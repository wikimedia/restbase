'use strict';

// mocha defines to avoid JSHint breakage
/* global describe, it, before, beforeEach, after, afterEach */

var assert = require('assert');
var preq   = require('preq');
var Router = require('../../../lib/router');
var server = require('../../utils/server');

var rootSpec = {
    paths: {
        '/{domain:en.wikipedia.org}/v1': {
            'x-modules': {
                content: {
                    path: 'v1/content.yaml',
                }
            }
        }
    }
};

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
                subspec1: {
                    path: 'test/features/router/subspec1.yaml',
                },
                subspec2: {
                    path: 'test/features/router/subspec2.yaml',
                },
            }
        }
    }
};

var overlappingMethodSpec = {
    paths: {
        '/{domain:en.wikipedia.org}/v1': {
            'x-modules': {
                subspec1: {
                    path: 'test/features/router/subspec1.yaml',
                },
                subspec1: {
                    path: 'test/features/router/subspec1.yaml',
                },
            }
        }
    }
};


var nestedSecuritySpec = {
    paths: {
        '/{domain:en.wikipedia.org}/v1': {
            'x-modules': {
                secure_subspec: {
                    path: 'test/features/router/secure_subspec.yaml'
                },
            },
            security: ['first'],
        }
    }
};


var fullSpec = server.loadConfig('config.example.wikimedia.yaml');

var fakeRestBase = { rb_config: {} };

describe('tree building', function() {

    before(function() { server.start(); });

    it('should build a simple spec tree', function() {
        var router = new Router();
        return router.loadSpec(rootSpec, fakeRestBase)
        .then(function() {
            //console.log(JSON.stringify(router.tree, null, 2));
            var handler = router.route('/en.wikipedia.org/v1/page/html/Foo');
            //console.log(handler);
            assert.equal(!!handler.value.methods.get, true);
            assert.equal(handler.params.domain, 'en.wikipedia.org');
            assert.equal(handler.params.title, 'Foo');
        });
    });

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

    it('should build the example config spec tree', function() {
        var router = new Router();
        var resourceRequests = [];
        return router.loadSpec(fullSpec.spec, {
            request: function(req) {
                resourceRequests.push(req);
            },
            rb_config: {},
        })
        .then(function() {
            var handler = router.route('/en.wikipedia.org/v1/page/html/Foo');
            assert.equal(resourceRequests.length > 0, true);
            assert.equal(!!handler.value.methods.get, true);
            assert.equal(handler.params.domain, 'en.wikipedia.org');
            assert.equal(handler.params.title, 'Foo');
        });
    });

    it('should allow adding methods to existing paths', function() {
        var router = new Router();
        return router.loadSpec(additionalMethodSpec, fakeRestBase)
        .then(function() {
            var handler = router.route('/en.wikipedia.org/v1/page/Foo/html');
            assert.equal(!!handler.value.methods.get, true);
            assert.equal(!!handler.value.methods.post, true);
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

    it('should not load root-spec params', function() {
        return preq.get({
            uri: server.config.baseURL + '/?spec'
        })
        .then(function(res) {
            assert.equal(res.body.paths[''], undefined);
        })
    });
});
