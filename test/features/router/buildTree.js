'use strict';

// mocha defines to avoid JSHint breakage
/* global describe, it, before, beforeEach, after, afterEach */

var assert = require('assert');
var preq   = require('preq');
var Router = require('hyperswitch/lib/router');
var server = require('../../utils/server');

var rootSpec = {
    paths: {
        '/{domain:en.wikipedia.org}/{api:v1}/page': {
            'x-modules': [
                {
                    path: 'v1/content.yaml'
                }
            ]
        }
    }
};

var fullSpec = server.loadConfig('config.example.wikimedia.yaml');

var fakeHyperSwitch = { config: {} };

describe('tree building', function() {

    before(function() { server.start(); });

    it('should build a simple spec tree', function() {
        var router = new Router({
            appBasePath: __dirname + '/../../..'
        });
        return router.loadSpec(rootSpec, fakeHyperSwitch)
        .then(function() {
            var handler = router.route('/en.wikipedia.org/v1/page/html/Foo');
            assert.equal(!!handler.value.methods.get, true);
            assert.equal(handler.params.domain, 'en.wikipedia.org');
            assert.equal(handler.params.title, 'Foo');
        });
    });

    it('should build the example config spec tree', function() {
        var router = new Router({
            appBasePath: __dirname + '/../../..'
        });
        var resourceRequests = [];
        return router.loadSpec(fullSpec.spec_root, {
            request: function(req) {
                resourceRequests.push(req);
            },
            config: {},
        })
        .then(function() {
            var handler = router.route('/en.wikipedia.org/v1/page/html/Foo');
            assert.equal(resourceRequests.length > 0, true);
            assert.equal(!!handler.value.methods.get, true);
            assert.equal(handler.params.domain, 'en.wikipedia.org');
            assert.equal(handler.params.title, 'Foo');
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
