"use strict";

// mocha defines to avoid JSHint breakage
/* global describe, it, before, beforeEach, after, afterEach */

var assert = require('../../utils/assert.js');
var preq   = require('preq');
var server = require('../../utils/server.js');
var nock = require('nock');

describe('Delete/undelete handling', function() {
    this.timeout(20000);

    before(function () {
        return server.start();
    });

    var apiURI = server.config
            .conf.templates['wmf-sys-1.0.0']
            .paths['/{module:action}']['x-modules'][0].options.apiRequest.uri;
    apiURI = apiURI.replace('{domain}', 'en.wikipedia.beta.wmflabs.org');

    function getEmptyResponse(revid) {
        return {'batchcomplete':'','query':{'badrevids':{'12345' :{'revid':'' + revid}}}};
    }
    function getApiResponse(title, revid, pageId) {
        return {
            'batchcomplete': '',
            'query': {
                'pages': {
                    '11089416': {
                        'pageid': pageId || 1111,
                        'ns': 0,
                        'title': title,
                        'contentmodel': 'wikitext',
                        'pagelanguage': 'en',
                        'touched': '2015-05-22T08:49:39Z',
                        'lastrevid': 653508365,
                        'length': 2941,
                        'revisions': [{
                            'revid': revid,
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
        };
    }

    function fetchPage(title, revision) {
        return preq.get({
            uri: server.config.labsBucketURL + '/title/' + title,
            headers: {
                'cache-control': 'no-cache'
            }
        })
        .then(function(res) {
            assert.deepEqual(res.status, 200);
            assert.deepEqual(res.body.items.length, 1);
            assert.deepEqual(res.body.items[0].rev, revision);
        });
    }

    function sendDeleteSignal(title) {
        // Now fetch info that it's deleted
        return preq.get({
            uri: server.config.labsBucketURL + '/title/' + title,
            headers: {
                'cache-control': 'no-cache'
            }
        })
        .then(function() {
            throw new Error('404 should have been returned for a deleted page');
        }, function(e) {
            assert.deepEqual(e.status, 404);
            assert.contentType(e, 'application/problem+json');
        })
    }

    function sendUndeleteSignal(title, revision) {
        // Now fetch info that it's deleted
        return preq.get({
            uri: server.config.labsBucketURL + '/title/' + title,
            headers: {
                'cache-control': 'no-cache'
            }
        })
        .then(function(res) {
            assert.deepEqual(res.status, 200);
            assert.deepEqual(res.body.items.length, 1);
            assert.deepEqual(res.body.items[0].rev, revision);
        });
    }

    function assertRevisionDeleted(revision) {
        return preq.get({uri: server.config.labsBucketURL + '/revision/' + revision})
        .then(function() {
            throw new Error('404 should have been returned for a deleted page');
        }, function(e) {
            assert.deepEqual(e.status, 404);
            assert.contentType(e, 'application/problem+json');
        });
    }

    function signalPageEdit(title, revision) {
        return preq.get({
            uri: server.config.labsBucketURL + '/html/' + title + '/' + revision,
            headers: {
                'cache-control': 'no-cache',
                'If-Unmodified-Since': new Date().toString
            }
        })
        .then(function(res) {
            assert.deepEqual(res.status, 200);
        });
    }

    // This test also prepares environment for other tests
    it('should set page_deleted on deleted page', function() {
        var title = 'TestingTitle';
        nock.enableNetConnect();
        var api = nock(apiURI)
        // Return a page so that we store it.
        .post('').reply(200, getApiResponse(title, 12345))
        // Return a new revision for the same page so that we store it.
        .post('').reply(200, getApiResponse(title, 12346))
        // Other requests return nothing as if the page is deleted.
        .post('').reply(200, getEmptyResponse(12346));

        // Fetch the page
        return fetchPage(title, 12345)
        .delay(1000)
        .then(function() { return fetchPage(title, 12346) })
        .then(function() { return sendDeleteSignal(title); })
        .then(function() { api.done(); })
        .finally(function() { nock.cleanAll(); });
    });

    it('should restrict access by revision', function() {
        return assertRevisionDeleted(12346);
    });

    it('should restrict access to older revisions', function() {
        return assertRevisionDeleted(12345);
    });

    it('should understand that page was undeleted', function() {
        var title = 'TestingTitle';
        nock.enableNetConnect();
        // After the previous test the page in storage is marked as deleted, so if MW API returns a response,
        // we need to understand that the page was undeleted and update a good_after
        var api = nock(apiURI)
        .post('').reply(200, getApiResponse(title, 12346, 12345));
        // Verify that it's deleted
        return preq.get({
            uri: server.config.labsBucketURL + '/title/' + title
        })
        .then(function() {
            throw new Error('Should throw 404');
        }, function(e) {
            assert.deepEqual(e.status, 404);
            assert.contentType(e, 'application/problem+json');
        })
        .then(function() { return sendUndeleteSignal(title, 12346); })
        .then(function() { return preq.get({uri: server.config.labsBucketURL + '/revision/' + 12346}); })
        .then(function(res) {
            assert.deepEqual(res.status, 200);
            assert.deepEqual(res.body.items.length, 1);
            assert.deepEqual(res.body.items[0].rev, 12346);
        })
        .then(function() { api.done(); })
        .finally(function() { nock.cleanAll(); });
    });

    it('should not undelete if a new page with the same title was created', function() {
        var title = 'TestingTitle2';
        nock.enableNetConnect();
        var api = nock(apiURI)
        // Return a page so that we store it.
        .post('').reply(200, getApiResponse(title, 12345))
        // Return a new revision for the same page so that we store it.
        .post('').reply(200, getApiResponse(title, 12346))
        // Other requests return nothing as if the page is deleted.
        .post('').reply(200, getEmptyResponse(12346))
        // And then we created a new page with the same title
        .post('').reply(200, getApiResponse(title, 12347));
        // Fetch the page
        return fetchPage(title, 12345)
        .delay(1000)
        .then(function() { return fetchPage(title, 12346) })
        .then(function() { return sendDeleteSignal(title); })
        .then(function() { return signalPageEdit(title, 12347); })
        .then(function() { return preq.get({uri: server.config.labsBucketURL + '/revision/' + 12347}); })
        .then(function(res) {
            assert.deepEqual(res.status, 200);
            assert.deepEqual(res.body.items.length, 1);
            assert.deepEqual(res.body.items[0].rev, 12347);
        })
        .then(function() { return assertRevisionDeleted(12345); })
        .then(function() { return assertRevisionDeleted(12346); })
        .then(function() { api.done(); })
        .finally(function() { nock.cleanAll(); });
    });

    it('should handle delete/undelete on pages created instead of deleted', function() {
        var title = 'TestingTitle3';
        nock.enableNetConnect();
        var api = nock(apiURI)
        // Return a page so that we store it.
        .post('').reply(200, getApiResponse(title, 12345))
        .post('').reply(200, getEmptyResponse(12345))
        .post('').reply(200, getApiResponse(title, 12346))
        .post('').reply(200, getEmptyResponse(12346))
        .post('').reply(200, getApiResponse(title, 12346, 12346));
        // Fetch the page
        return fetchPage(title, 12345)
        .then(function() { return sendDeleteSignal(title); })
        .then(function() { return signalPageEdit(title, 12346); })
        .then(function() { return sendDeleteSignal(title); })
        .then(function() { return sendUndeleteSignal(title, 12346); })
        .then(function() { return preq.get({uri: server.config.labsBucketURL + '/revision/' + 12346}); })
        .then(function(res) {
            assert.deepEqual(res.status, 200);
            assert.deepEqual(res.body.items.length, 1);
            assert.deepEqual(res.body.items[0].rev, 12346);
        })
        .then(function() { return assertRevisionDeleted(12345); })
        .then(function() { api.done(); })
        .finally(function() { nock.cleanAll(); });
    });
});