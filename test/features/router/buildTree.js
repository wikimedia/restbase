'use strict';

// mocha defines to avoid JSHint breakage
/* global describe, it, before, beforeEach, after, afterEach */

var fs = require('fs');
var yaml = require('js-yaml');

var assert = require('assert');
var Router = require('../../../lib/router');
var router = new Router();

var rootSpec = {
    paths: {
        '/{domain:en.wikipedia.org}/v1': {
            'x-restbase': {
                interfaces: [
                    'mediawiki/v1/content'
                ]
            }
        }
    }
};

var fullSpec = yaml.safeLoad(fs.readFileSync('config.example.yaml'));

describe('tree building', function() {
    it('should build a simple spec tree', function() {
        router.loadSpec(rootSpec);
        //console.log(JSON.stringify(router.tree, null, 2));
        var handler = router.route('/en.wikipedia.org/v1/page/Foo/html');
        //console.log(handler);
        assert.equal(!!handler.value.methods.get, true);
        assert.equal(handler.params.domain, 'en.wikipedia.org');
        assert.equal(handler.params.title, 'Foo');
    });

    it('should build the example config spec tree', function() {
        router.loadSpec(fullSpec.spec);
        //console.log(JSON.stringify(router.tree, null, 2));
        var handler = router.route('/en.wikipedia.org/v1/page/Foo/html');
        //console.log(handler);
        assert.equal(!!handler.value.methods.get, true);
        assert.equal(handler.params.domain, 'en.wikipedia.org');
        assert.equal(handler.params.title, 'Foo');
    });
});

module.exports = function () {};
