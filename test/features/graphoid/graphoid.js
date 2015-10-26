"use strict";

// mocha defines to avoid JSHint breakage
/* global describe, it, before, beforeEach, after, afterEach */

var assert = require('../../utils/assert.js');
var preq   = require('preq');
var server = require('../../utils/server.js');
var fs = require('fs');

describe('Graphoid tests:', function() {
    var graph_definition = JSON.parse(fs.readFileSync(__dirname + '/graph.json'));
    var invalid_graph_definition = JSON.parse(fs.readFileSync(__dirname + '/invalid_graph.json'));
    var resource_location;
    var svgRender;
    var pngRender;

    before(function () { return server.start(); });

    it('Should render graph in the store mode', function() {
        return preq.post({
            uri: server.config.baseURL + '/media/graph/svg',
            headers: {
                'content-type': 'application/json'
            },
            body: graph_definition
        })
        .then(function(res) {
            assert.deepEqual(res.status, 200);
            resource_location = res.headers['x-resource-location'];
            assert.deepEqual(res.headers['content-type'], 'image/svg+xml');
            assert.deepEqual(!!resource_location, true);
            return preq.get({
                uri: server.config.baseURL + '/media/graph/svg/' + resource_location
            });
        })
        .then(function(res) {
            assert.deepEqual(res.status, 200);
            assert.deepEqual(!!res.body, true);
            assert.deepEqual(res.headers['content-type'], 'image/svg+xml');
            svgRender = res.body;
        });
    });

    it('Should fetch svg as png', function() {
        return preq.get({
            uri: server.config.baseURL + '/media/graph/png/' + resource_location
        }).then(function(res) {
            assert.deepEqual(res.status, 200);
            assert.deepEqual(res.headers['content-type'], 'image/png');
            assert.deepEqual(!!res.body, true);
            pngRender = res.body;
        });
    });

    it('Should not rerender same requests', function() {
        return preq.post({
            uri: server.config.baseURL + '/media/graph/svg',
            headers: {
                'content-type': 'application/json'
            },
            body: graph_definition
        })
        .then(function(res) {
            assert.deepEqual(res.status, 200);
            assert.deepEqual(res.body, svgRender);
            assert.deepEqual(res.headers['content-type'], 'image/svg+xml');
            return preq.post({
                uri: server.config.baseURL + '/media/graph/png',
                headers: {
                    'content-type': 'application/json'
                },
                body: graph_definition
            });
        })
        .then(function(res) {
            assert.deepEqual(res.status, 200);
            assert.deepEqual(res.body, pngRender);
            assert.deepEqual(res.headers['content-type'], 'image/png');
        });
    });

    it('Should rerender content on get with cache-control: no-cache', function() {
        return preq.get({
            uri: server.config.baseURL + '/media/graph/png/' + resource_location,
            headers: {
                'cache-control': 'no-cache'
            }
        })
        .then(function(res) {
            assert.deepEqual(res.status, 200);
            assert.deepEqual(!!res.body, true);
            assert.notDeepEqual(pngRender, res.body);
            assert.deepEqual(res.headers['content-type'], 'image/png');
            pngRender = res.body;
            return preq.get({
                uri: server.config.baseURL + '/media/graph/svg/' + resource_location
            });
        })
        .then(function(res) {
            assert.deepEqual(res.status, 200);
            assert.deepEqual(!!res.body, true);
            assert.notDeepEqual(svgRender, res.body);
            assert.deepEqual(res.headers['content-type'], 'image/svg+xml');
            svgRender = res.body
        });
    });

    it('Should rerender content on post with cache-control: no-cache', function() {
        return preq.post({
            uri: server.config.baseURL + '/media/graph/png',
            headers: {
                'cache-control': 'no-cache',
                'content-type': 'application/json'
            },
            body: graph_definition
        })
        .then(function(res) {
            assert.deepEqual(res.status, 200);
            assert.deepEqual(!!res.body, true);
            assert.notDeepEqual(pngRender, res.body);
            assert.deepEqual(res.headers['content-type'], 'image/png');
            pngRender = res.body;
            return preq.post({
                uri: server.config.baseURL + '/media/graph/svg',
                headers: {
                    'content-type': 'application/json'
                },
                body: graph_definition
            });
        })
        .then(function(res) {
            assert.deepEqual(res.status, 200);
            assert.deepEqual(!!res.body, true);
            assert.notDeepEqual(svgRender, res.body);
            assert.deepEqual(res.headers['content-type'], 'image/svg+xml');
            svgRender = res.body;
        });
    });

    it('Should not store request in preview mode', function() {
        return preq.post({
            uri: server.config.baseURL + '/media/graph/png?mode=preview',
            headers: {
                'content-type': 'application/json'
            },
            body: graph_definition
        })
        .then(function(res) {
            assert.deepEqual(res.status, 200);
            assert.deepEqual(!!res.body, true);
            assert.notDeepEqual(pngRender, res.body);
            resource_location = res.headers['x-resource-location'];
            pngRender = res.body;
            assert.deepEqual(res.headers['content-type'], 'image/png');
            return preq.get({
                uri: server.config.baseURL + '/media/graph/png/' + resource_location
            });
        })
        .then(function(res) {
            assert.deepEqual(res.status, 200);
            assert.deepEqual(!!res.body, true);
            assert.notDeepEqual(pngRender, res.body);
            assert.deepEqual(res.headers['content-type'], 'image/png');
            pngRender = res.body;
            return preq.get({
                uri: server.config.baseURL + '/media/graph/svg/' + resource_location
            });
        })
        .then(function() {
            throw new Error('Should not find the resource');
        }, function(e) {
            assert.deepEqual(e.status, 404);
        })
        // Now wait a bit to let content expire
        .delay(5000)
        .then(function() {
            return preq.get({
                uri: server.config.baseURL + '/media/graph/png/' + resource_location
            });
        })
        .then(function() {
            throw new Error('Should not find the resource');
        }, function(e) {
            assert.deepEqual(e.status, 404);
        });
    });

    it('Should propagate errors for invalid graph', function() {
        return preq.post({
            uri: server.config.baseURL + '/media/graph/png',
            headers: {
                'content-type': 'application/json'
            },
            body: invalid_graph_definition
        })
        .then(function() {
            throw new Error('Error should be thrown');
        }, function(e) {
            assert.deepEqual(e.status, 400);
        });
    });
});