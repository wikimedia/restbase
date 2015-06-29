'use strict';

// mocha defines to avoid JSHint breakage
/* global describe, it, before, beforeEach, after, afterEach */

var assert = require('../../utils/assert.js');
var preq   = require('preq');
var server = require('../../utils/server.js');
var nock = require('nock');

describe('404 handling', function() {

    this.timeout(20000);

    before(function () { return server.start(); });

    it('should return a proper 404 when trying to retrieve a non-existing domain', function() {
        return preq.get({
            uri: server.config.hostPort + '/v1/foobar.com'
        })
        .catch(function(e) {
            assert.deepEqual(e.status, 404);
            assert.contentType(e, 'application/problem+json');
        });
    });
    it('should return a proper 404 when trying to list a non-existing domain', function() {
        return preq.get({
            uri: server.config.hostPort + '/v1/foobar.com/'
        })
        .catch(function(e) {
            assert.deepEqual(e.status, 404);
            assert.contentType(e, 'application/problem+json');
        });
    });
    it('should return a proper 404 when accessing an unknown bucket', function() {
        return preq.get({
            uri: server.config.baseURL + '/some_nonexisting_bucket'
        })
        .catch(function(e) {
            assert.deepEqual(e.status, 404);
            assert.contentType(e, 'application/problem+json');
        });
    });
    it('should return a proper 404 when trying to list an unknown bucket', function() {
        return preq.get({
            uri: server.config.baseURL + '/some_nonexisting_bucket/'
        })
        .catch(function(e) {
            assert.deepEqual(e.status, 404);
            assert.contentType(e, 'application/problem+json');
        });
    });
    it('should return a proper 404 when accessing an item in an unknown bucket', function() {
        return preq.get({
            uri: server.config.baseURL + '/some_nonexisting_bucket/item'
        })
        .catch(function(e) {
            assert.deepEqual(e.status, 404);
            assert.contentType(e, 'application/problem+json');
        });
    });
    it('should return a proper 404 for the latest revision of a missing page', function() {
        return preq.get({
            uri: server.config.bucketURL + '/ThisIsProblablyNotARealPateTitle/html'
        })
        .catch(function(e) {
            assert.deepEqual(e.status, 404);
            assert.contentType(e, 'application/problem+json');
        });
    });
    it('should return 404 on deleted revision', function() {
        return preq.get({
            uri: server.config.bucketURL + '/revision/668588412'
        })
        .then(function() {
            throw new Error('404 should be returned')
        })
        .catch(function(e) {
            assert.deepEqual(e.status, 404);
            assert.contentType(e, 'application/problem+json');
        });
    });
    it('should set page_deleted on deleted page', function() {
        var apiURI = server.config
        .conf.templates['wmf-sys-1.0.0']
        .paths['/{module:action}']['x-modules'][0].options.apiURI;
        var title = 'TestingTitle';
        var revision = 12345;

        nock.enableNetConnect();
        var api = nock(apiURI)
            // The first request should return a page so that we store it.
        .post('')
        .reply(200, {
            'batchcomplete': '',
            'query': {
                'pages': {
                    '11089416': {
                        'pageid': 11089416,
                        'ns': 0,
                        'title': title,
                        'contentmodel': 'wikitext',
                        'pagelanguage': 'en',
                        'touched': '2015-05-22T08:49:39Z',
                        'lastrevid': 653508365,
                        'length': 2941,
                        'revisions': [{
                            'revid': revision,
                            'user': 'Chuck Norris',
                            'userid': 3606755,
                            'timestamp': '2015-03-25T20:29:50Z',
                            'size': 2941,
                            'sha1': 'c47571122e00f28402d2a1b75cff77a22e7bfecd',
                            'contentmodel': 'wikitext',
                            'comment': 'Test',
                            'tags': []
                        }]
                    }
                }
            }
        })
        // Other requests return nothing as if the page is deleted.
        .post('')
        .reply(200, {})
        .post('')
        .reply(200, {});
        // Fetch the page
        return preq.get({
            uri: server.config.bucketURL + '/title/' + title + '/latest'
        })
        .then(function(res) {
            assert.deepEqual(res.status, 200);
            assert.deepEqual(res.body.items.length, 1);
            assert.deepEqual(res.body.items[0].rev, revision);
        })
        // Now fetch info that it's deleted
        .then(function() {
            return preq.get({uri: server.config.bucketURL + '/title/' + title + '/latest'});
        })
        .then(function() {
            throw new Error('404 should have been returned for a deleted page');
        })
        .catch(function(e) {
            assert.deepEqual(e.status, 404);
            assert.contentType(e, 'application/problem+json');
        })
        // Getting it by revision id should also return 404
        .then(function() {
            return preq.get({uri: server.config.bucketURL + '/revision/' + revision});
        })
        .then(function() {
            throw new Error('404 should have been returned for a deleted page');
        })
        .catch(function(e) {
            assert.deepEqual(e.status, 404);
            assert.contentType(e, 'application/problem+json');
        })
        .then(function() {
            api.done();
        })
        .finally(function() {
            nock.cleanAll();
            nock.restore();
        });
    })
});
