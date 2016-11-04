'use strict';

// mocha defines to avoid JSHint breakage
/* global describe, it, before, beforeEach, after, afterEach */

var assert  = require('../../utils/assert.js');
var preq    = require('preq');
var server  = require('../../utils/server.js');
var nock    = require('nock');
var mwUtils =

describe('400 handling', function() {
    this.timeout(20000);

    var siteInfo;
    var revisionInfo;
    before(function () {
        return server.start()
        .then(function() {
            // Fetch real siteInfo to return from a mock
            return preq.post({
                uri: server.config.labsApiURL,
                body: {
                    action: 'query',
                    meta: 'siteinfo|filerepoinfo',
                    siprop: 'general|namespaces|namespacealiases',
                    format: 'json',
                    formatversion: 2
                }
            });
        })
        .then(function(res) {
            siteInfo = res.body;
            // Fetch real revision info for Main_Page
            return preq.post({
                uri: server.config.labsApiURL,
                body: {
                    action: 'query',
                    prop: 'info|revisions',
                    continue: '',
                    rvprop: 'ids|timestamp|user|userid|size|sha1|contentmodel|comment|tags',
                    format: 'json',
                    formatversion: 2,
                    titles: 'Main_Page'
                }
            });
        })
        .then(function(res) {
            revisionInfo = res.body;
        })
    });

    it('should refetch siteInfo on error', function() {
        // Set up nock:
        // 1. Throw an error on siteInfo fetch
        // 2. Return correct siteInfo
        // 3. Return revision data
        var mwApi = nock(server.config.labsApiURL, {allowUnmocked: true})
        .post('').reply(400)
        .post('').reply(200, siteInfo)
        .post('').reply(200, revisionInfo);

        return preq.get({
            uri: server.config.labsBucketURL + '/title/Main_Page'
        })
        .catch(function (e) {
            assert.deepEqual(e.status, 400);
            return preq.get({
                uri: server.config.labsBucketURL + '/title/Main_Page'
            });
        })
        .then(function(res) {
            assert.deepEqual(res.status, 200);
            assert.deepEqual(res.body.items[0].title, 'Main_Page');
            mwApi.done();
        })
        .finally(function () { nock.cleanAll(); })
    });

    it('should return a proper 400 for an empty POST', function() {
        return preq.post({
            uri: server.config.hostPort,
            headers: {
                'content-type': 'foo/bar'
            },
        })
        .catch(function(e) {
            assert.deepEqual(e.status, 400);
            assert.contentType(e, 'application/problem+json');
        });
    });

    it('should return a proper 400 for an invalid POST', function() {
        return preq.post({
            uri: server.config.hostPort,
            headers: {
                'content-type': 'foo/bar'
            },
            body: 'baz'
        })
        .catch(function(e) {
            assert.deepEqual(e.status, 400);
            assert.contentType(e, 'application/problem+json');
        });
    });
});
