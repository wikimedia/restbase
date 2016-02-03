'use strict';

var assert = require('../utils/assert.js');
var Server = require('../utils/server.js');
var preq   = require('preq');
var nock   = require('nock');

// mocha defines to avoid JSHint breakage
/* global describe, it, before, beforeEach, after, afterEach */

describe('Handler Template', function() {
    var server;

    it('Runs the setup handler', function() {
        var api = nock('http://mocked_domain_for_tests.com', {
            reqheaders: {
                test: 'test_value'
            }
        })
        .get('/test').reply(200, '');

        server = new Server('test/framework/handlerTemplate/test_config.yaml');
        return server.start()
        .then(function() { api.done(); })
        .finally(function() { nock.cleanAll(); });
    });

    it('Retrieve content from backend service', function () {
        var mockReply = '<html><head><title>1</title></head><body></body></html>';
        var api = nock('http://mocked_domain_for_tests.com')
        .get('/TestTitle').reply(200, mockReply, { 'Content-Type': 'text/html' });

        return preq.get({ uri: server.hostPort + '/service/simple_test/TestTitle' })
        .then(function (res) {
            assert.deepEqual(res.status, 200);
            assert.deepEqual(res.headers['content-type'], 'text/html');
            assert.deepEqual(res.body, mockReply);
        })
        .then(function() { api.done(); })
        .finally(function() { nock.cleanAll(); });
    });

    it('Retrieve content from backend service in parallel', function () {
        var mockReply1 = '<html><head><title>1</title></head><body></body></html>';
        var mockReply2 = '<html><head><title>2</title></head><body></body></html>';
        var api = nock('http://mocked_domain_for_tests.com')
        .get('/TestTitle').reply(200, mockReply1, { 'Content-Type': 'text/html' })
        .get('/TestTitle').reply(200, mockReply2, { 'Content-Type': 'text/html' });

        return preq.get({ uri: server.hostPort + '/service/parallel_test/TestTitle' })
        .then(function (res) {
            assert.deepEqual(res.status, 200);
            assert.deepEqual(res.headers['content-type'], 'application/json');
            assert.deepEqual([res.body.res1, res.body.res2].sort(), [mockReply1, mockReply2]);
        })
        .then(function() { api.done(); })
        .finally(function() { nock.cleanAll(); });
    });

    it('Returns response on return_if match', function() {
        var mockReply = '<html><head><title>1</title></head><body></body></html>';
        var api = nock('http://mocked_domain_for_tests.com')
        .get('/TestTitle').reply(200, mockReply, { 'Content-Type': 'text/html' });

        return preq.get({ uri: server.hostPort + '/service/return_if_test/TestTitle' })
        .then(function (res) {
            assert.deepEqual(res.status, 200);
            assert.deepEqual(res.headers['content-type'], 'text/html');
            assert.deepEqual(res.body, mockReply);
        })
        .then(function() { api.done(); })
        .finally(function() { nock.cleanAll(); });
    });

    it('Follows a chain on simple catch match', function() {
        var mockReply = '<html><head><title>1</title></head><body></body></html>';
        var api = nock('http://mocked_domain_for_tests.com')
        .get('/TestTitle').reply(404, 'NOT FOUND', { 'Content-Type': 'text/plain' })
        .get('/TestTitle').reply(200, mockReply, { 'Content-Type': 'text/html' });

        return preq.get({ uri: server.hostPort + '/service/simple_catch/TestTitle' })
        .then(function (res) {
            assert.deepEqual(res.status, 200);
            assert.deepEqual(res.headers['content-type'], 'text/html');
            assert.deepEqual(res.body, mockReply);
        })
        .then(function() { api.done(); })
        .finally(function() { nock.cleanAll(); });
    });

    it('Follows a chain on array catch match', function() {
        var mockReply = '<html><head><title>1</title></head><body></body></html>';
        var api = nock('http://mocked_domain_for_tests.com')
        .get('/TestTitle').reply(404, 'NOT FOUND', { 'Content-Type': 'text/plain' })
        .get('/TestTitle').reply(200, mockReply, { 'Content-Type': 'text/html' })
        .get('/TestTitle').reply(302, 'WHATEVER', { 'Content-Type': 'text/plain' })
        .get('/TestTitle').reply(200, mockReply, { 'Content-Type': 'text/html' });

        return preq.get({ uri: server.hostPort + '/service/return_if_test/TestTitle' })
        .then(function (res) {
            assert.deepEqual(res.status, 200);
            assert.deepEqual(res.headers['content-type'], 'text/html');
            assert.deepEqual(res.body, mockReply);
            return preq.get({ uri: server.hostPort + '/service/return_if_test/TestTitle' });
        })
        .then(function (res) {
            assert.deepEqual(res.status, 200);
            assert.deepEqual(res.headers['content-type'], 'text/html');
            assert.deepEqual(res.body, mockReply);
        })
        .then(function() { api.done(); })
        .finally(function() { nock.cleanAll(); });
    });

    it('Propagates error on catch mismatch', function() {
        var api = nock('http://mocked_domain_for_tests.com')
        .get('/TestTitle').reply(500, 'SERVER_ERROR', { 'Content-Type': 'text/plain' });

        return preq.get({ uri: server.hostPort + '/service/return_if_test/TestTitle' })
        .then(function () {
            throw new Error('Error should be thrown');
        }, function(e) {
            assert.deepEqual(e.status, 500);
            assert.deepEqual(e.headers['content-type'], 'text/plain');
        })
        .then(function() { api.done(); })
        .finally(function() { nock.cleanAll(); });
    });

    it('Supports non-status conditions', function() {
        var api = nock('http://mocked_domain_for_tests.com')
        .get('/TestTitle').reply(200, { test: 'test' }, { 'Content-Type': 'application/json' });

        return preq.get({ uri: server.hostPort + '/service/non_status_catch/TestTitle' })
        .then(function(res) {
            assert.deepEqual(res.status, 200);
            assert.deepEqual(res.body, { test: 'test'});
        })
        .then(function() { api.done(); })
        .finally(function() { nock.cleanAll(); });
    });

    after(function() { return server.stop(); });
});