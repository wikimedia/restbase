'use strict';

// mocha defines to avoid JSHint breakage
/* global describe, it, before, beforeEach, after, afterEach */

var fs = require('fs');
var yaml = require('js-yaml');

var assert = require('assert');
var Router = require('../../../lib/router');
var loadConfig = require('../../utils/server').loadConfig;
var router = new Router();

var rootSpec = {
    paths: {
        '/{domain:en.wikipedia.test.local}/v1': {
            'x-subspecs': [
                {
                    paths: {
                        '/page/{title}/html': {
                            get: {
                                'x-backend-request': {
                                    uri: '/{domain}/sys/parsoid/html/{title}'
                                }
                            }
                        }
                    }
                }
            ]
        }
    }
};

var faultySpec = {
    paths: {
        '/{domain:en.wikipedia.test.local}': {
            'x-subspecs': ['some/non/existing/spec']
        }
    }
};

var additionalMethodSpec = {
    paths: {
        '/{domain:en.wikipedia.test.local}/v1': {
            'x-subspecs': [
                {
                    paths: {
                        '/page/{title}/html': {
                            get: {
                                'x-backend-request': {
                                    uri: '/{domain}/sys/parsoid/html/{title}'
                                }
                            }
                        }
                    }
                },
                {
                    paths: {
                        '/page/{title}/html': {
                            post: {
                                'x-backend-request': {
                                    uri: '/{domain}/sys/parsoid/html/{title}'
                                }
                            }
                        }
                    }
                }
            ]
        }
    }
};

var overlappingMethodSpec = {
    paths: {
        '/{domain:en.wikipedia.test.local}/v1': {
            'x-subspecs': [
                {
                    paths: {
                        '/page/{title}/html': {
                            get: {
                                'x-backend-request': {
                                    uri: '/{domain}/sys/parsoid/html/{title}'
                                }
                            }
                        }
                    }
                },
                {
                    paths: {
                        '/page/{title}/html': {
                            get: {
                                'x-backend-request': {
                                    uri: '/{domain}/sys/parsoid/html/{title}'
                                }
                            }
                        }
                    }
                }
            ]
        }
    }
};

var nestedSecuritySpec = {
    paths: {
        '/{domain:en.wikipedia.test.local}/v1': {
            'x-subspecs': [
                {
                    paths: {
                        '/page': {
                            'x-subspec': {
                                paths: {
                                    '/secure': {
                                        get: {
                                            'x-backend-request': {
                                                uri: '/{domain}/sys/parsoid/html/{title}'
                                            }
                                        }
                                    }
                                }
                            },
                            security: [ 'second', 'third' ]
                        }
                    }
                }
            ],
            security: [ 'first' ]
        }
    }
};

var parsoidSpec = {
    'x-modules': [
        {
            name: 'parsoid',
            version: '1.0.0',
            type: 'file',
            options: {
                parsoidHost: 'http://parsoid-lb.eqiad.wikimedia.org'
            }
        }
    ]
};

var sameModuleAtDifferentPathsSpec = {
    paths: {
        '/{domain:en.wikipedia.org}/v1': {
            'x-subspecs': [
                {
                    paths: {
                        '/parsoid': parsoidSpec
                    }
                }
            ]
        },
        '/{domain:secure.wikipedia.org}/v1': {
            'x-subspecs': [
                {
                    paths: {
                        '/parsoid': parsoidSpec
                    }
                }
            ],
            'additions_property': 'test'
        }
    }
};

var fullSpec = loadConfig('config.example.yaml');
var fullSpec = loadConfig('config.test.yaml');

describe('tree building', function() {

    it('should build a simple spec tree', function() {
        return router.loadSpec(rootSpec)
        .then(function() {
            //console.log(JSON.stringify(router.tree, null, 2));
            var handler = router.route('/en.wikipedia.test.local/v1/page/Foo/html');
            //console.log(handler);
            assert.equal(!!handler.value.methods.get, true);
            assert.equal(handler.params.domain, 'en.wikipedia.test.local');
            assert.equal(handler.params.title, 'Foo');
        });
    });

    it('should fail loading a faulty spec', function() {
        return router.loadSpec(faultySpec)
        .then(function() {
            throw new Error("Should throw an exception!");
        },
        function(e) {
            // exception thrown as expected
            return;
        });
    });

    it('should build the example config spec tree', function() {
        var resourceRequests = [];
        return router.loadSpec(fullSpec.spec, {
            request: function(req) {
                resourceRequests.push(req);
            }
        })
        .then(function() {
            //console.log(JSON.stringify(router.tree, null, 2));
            var handler = router.route('/en.wikipedia.test.local/v1/page/html/Foo');
            //console.log(handler);
            assert.equal(resourceRequests.length > 0, true);
            assert.equal(!!handler.value.methods.get, true);
            assert.equal(handler.params.domain, 'en.wikipedia.test.local');
            assert.equal(handler.params.title, 'Foo');
        });
    });

    it('should allow adding methods to existing paths', function() {
        return router.loadSpec(additionalMethodSpec)
        .then(function() {
            var handler = router.route('/en.wikipedia.test.local/v1/page/Foo/html');
            assert.equal(!!handler.value.methods.get, true);
            assert.equal(!!handler.value.methods.post, true);
        });
    });

    it('should on overlapping methods on the same path', function() {
        return router.loadSpec(additionalMethodSpec)
        .then(function() {
            throw new Error("Should throw an exception!");
        },
        function(e) {
            // exception thrown as expected
            return;
        });
    });

    it('should parse permission along the path to endpoint', function() {
        return router.loadSpec(nestedSecuritySpec)
        .then(function() {
            var handler = router.route('/en.wikipedia.test.local/v1/page/secure');
            assert.deepEqual(handler.permissions, ['first', 'second', 'third']);
        });
    });
});
