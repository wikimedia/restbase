'use strict';

// mocha defines to avoid JSHint breakage
/* global describe, it, before, beforeEach, after, afterEach */

var fs = require('fs');
var yaml = require('js-yaml');

var assert = require('../../utils/assert.js');
var RBRouteTreeBuilder = require('../../../lib/router');
var router = new RBRouteTreeBuilder();

var rootSpec = {
    paths: {
        '/en.wikipedia.org/v1': {
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
        var tree = router.buildTree(rootSpec);
        console.log(JSON.stringify(tree, null, 2));
    });

    it('should build the example config spec tree', function() {
        var tree = router.buildTree(fullSpec.spec);
        console.log(JSON.stringify(tree, null, 2));
    });
});

module.exports = function () {};
