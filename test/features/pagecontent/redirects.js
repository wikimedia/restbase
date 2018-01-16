'use strict';

// mocha defines to avoid JSHint breakage
/* global describe, it, before, beforeEach, after, afterEach */

var mwUtil = require('../../../lib/mwUtil');
var assert = require('../../utils/assert.js');
var preq   = require('preq');
var server = require('../../utils/server.js');

describe('Redirects', function() {
    before(function() { return server.start(); });

    describe('', () => {
    it('should redirect to a normalized version of a title', function() {
        return preq.get({
            uri: server.config.bucketURL + '/html/Main%20Page?test=mwAQ',
            followRedirect: false
        })
        .then(function(res) {
            assert.deepEqual(res.status, 301);
            assert.deepEqual(res.headers['location'], 'Main_Page?test=mwAQ');
            assert.deepEqual(res.headers['cache-control'], 'test_purged_cache_control');
        });
    });

    it('should preserve parameters while redirecting to a normalized version of a title', function() {
        return preq.get({
            uri: server.config.bucketURL + '/html/Main%20Page/1234?test=mwAQ',
            followRedirect: false
        })
        .then(function(res) {
            assert.deepEqual(res.status, 301);
            assert.deepEqual(res.headers['location'], '../Main_Page/1234?test=mwAQ');
            assert.deepEqual(res.headers['cache-control'], 'test_purged_cache_control');
        });
    });

    it('should preserve parameters while redirecting to a normalized version of a title, #2', function() {
        return preq.get({
            uri: server.config.bucketURL + '/html/Main%20Page/',
            followRedirect: false
        })
        .then(function(res) {
            assert.deepEqual(res.status, 301);
            assert.deepEqual(res.headers['location'], '../Main_Page/');
            assert.deepEqual(res.headers['cache-control'], 'test_purged_cache_control');
        });
    });

    it('should not redirect to a normalized version of a title, no-cache', function() {
        return preq.get({
            uri: server.config.bucketURL + '/html/Main%20Page?test=mwAQ',
            headers: {
                'cache-control': 'no-cache'
            },
            followRedirect: false
        })
        .then(function(res) {
            assert.deepEqual(res.status, 200);
        });
    });

    it('should redirect to commons for missing file pages', function() {
        return preq.get({
            uri: server.config.bucketURL + '/html/File:ThinkingMan_Rodin.jpg',
            followRedirect: false
        })
        .then(function(res) {
            assert.deepEqual(res.status, 302);
            assert.deepEqual(res.headers['location'],
                'https://commons.wikimedia.org/api/rest_v1/page/html/File%3AThinkingMan_Rodin.jpg');
            assert.deepEqual(res.headers['cache-control'], 'test_purged_cache_control');
        });
    });

    it('should redirect to commons for missing file pages, dewiki', function() {
        return preq.get({
            uri: server.config.hostPort + '/de.wikipedia.org/v1/page/html/Datei:Name.jpg',
            followRedirect: false
        })
        .then(function(res) {
            assert.deepEqual(res.status, 302);
            assert.deepEqual(res.headers['location'],
                'https://commons.wikimedia.org/api/rest_v1/page/html/File%3AName.jpg');
            assert.deepEqual(res.headers['cache-control'], 'test_purged_cache_control');
        });
    });

    it('should not redirect to commons for missing file pages, redirect=false', function() {
        return preq.get({
            uri: server.config.bucketURL + '/html/File:ThinkingMan_Rodin.jpg?redirect=false'
        })
        .then(function() {
            throw new Error('Error should be thrown');
        }, function(e) {
            assert.deepEqual(e.status, 404);
        });
    });

    it('should not redirect to commons for missing file pages, no-cache', function() {
        return preq.get({
            uri: server.config.bucketURL + '/html/File:ThinkingMan_Rodin.jpg',
            headers: {
                'cache-control': 'no-cache'
            }
        })
        .then(function() {
            throw new Error('Error should be thrown');
        }, function(e) {
            assert.deepEqual(e.status, 404);
        });
    });

    it('should append ?redirect=false to self-redirecting pages', function() {
        return preq.get({
            uri: server.config.labsBucketURL + '/html/User:Pchelolo%2FSelf_Redirect',
            followRedirect: false
        })
        .then(function(res) {
            assert.deepEqual(res.status, 302);
            assert.deepEqual(res.headers.location, 'User%3APchelolo%2FSelf_Redirect?redirect=false');
        });
    });

    it('should not redirect if file is missing on commons', function() {
        return preq.get({
            uri: server.config.hostPort +
            '/commons.wikimedia.org/v1/html/File:Some_File_That_Does_Not_Exist.jpg'
        })
        .then(function() {
            throw new Error('Error should be thrown');
        }, function(e) {
            assert.deepEqual(e.status, 404);
        });
    });

    it('should result in 404 if + is normalized by MW API', function() {
        return preq.get({
            uri: server.config.labsBucketURL + '/html/User:Pchelolo%2FOnDemand+Test'
        })
        .then(function() {
            throw new Error('Error should be thrown');
        }, function(e) {
            assert.deepEqual(e.status, 404);
        });
    });

    it('should not redirect if redirect=false and page is not in storage', function() {
        return preq.get({
            uri: server.config.bucketURL + '/html/User:Pchelolo%2fRedirect_Test2?redirect=false',
            followRedirect: false
        })
        .then(function(res) {
            assert.deepEqual(res.status, 200);
            assert.deepEqual(res.headers.location, undefined);
            assert.deepEqual(res.headers['content-location'],
                'https://en.wikipedia.org/api/rest_v1/page/html/User%3APchelolo%2FRedirect_Test2?redirect=false')
            assert.deepEqual(res.body.length > 0, true);
        });
    });

    it('should return 302 for redirect pages html and data-parsoid', function() {
        return preq.get({
            uri: server.config.labsBucketURL + '/html/User:Pchelolo%2fRedirect_Test',
            followRedirect: false
        })
        .then(function(res) {
            assert.deepEqual(res.status, 302);
            assert.deepEqual(res.headers.location, 'User%3APchelolo%2FRedirect_Target_%25');
            assert.deepEqual(res.headers['cache-control'], 'test_purged_cache_control');
            assert.deepEqual(res.body.length > 0, true);
            assert.deepEqual(/Redirect Target/.test(res.body.toString()), false);
            var renderInfo = mwUtil.parseETag(res.headers.etag);
            return preq.get({
                uri: server.config.labsBucketURL + '/data-parsoid/User:Pchelolo%2fRedirect_Test/'
                    + renderInfo.rev + '/' + renderInfo.tid,
                followRedirect: false
            })
            .then(function(res) {
                assert.deepEqual(res.status, 302);
                assert.deepEqual(res.headers.location, '../../User%3APchelolo%2FRedirect_Target_%25');
                assert.deepEqual(res.headers['cache-control'], 'test_purged_cache_control');
                assert.deepEqual(res.headers['content-type'], server.config.conf.test.content_types['data-parsoid']);
                assert.deepEqual(Object.keys(res.body).length > 0, true);
            });
        });
    });

    it('should return 302 for redirect pages html, entities', function() {
        return preq.get({
            uri: server.config.labsBucketURL + '/html/User:Pchelolo%2fRedirect_Test_Amp',
            followRedirect: false
        })
        .then(function(res) {
            assert.deepEqual(res.status, 302);
            assert.deepEqual(res.headers.location, 'User%3APchelolo%2FRedirect_Target_%26');
            assert.deepEqual(res.headers['cache-control'], 'test_purged_cache_control');
            assert.deepEqual(res.body.length > 0, true);
            assert.deepEqual(/Redirect Target/.test(res.body.toString()), false);
        });
    });

    it('should return 302 for redirect pages html, hash', function() {
        return preq.get({
            uri: server.config.labsBucketURL + '/html/User:Pchelolo%2fRedirect_Test_Hash',
            followRedirect: false
        })
        .then(function(res) {
            assert.deepEqual(res.status, 302);
            assert.deepEqual(res.headers.location, 'Main_Page');
            assert.deepEqual(res.body.length > 0, true);
            assert.deepEqual(res.headers['cache-control'], 'test_purged_cache_control');
        });
    });

    it('should return 200 for redirect pages html with redirect=no', function() {
        return preq.get({
            uri: server.config.labsBucketURL + '/html/User:Pchelolo%2fRedirect_Test?redirect=no',
            followRedirect: false
        })
        .then(function(res) {
            assert.deepEqual(res.status, 200);
            assert.deepEqual(res.headers.location, undefined);
            assert.deepEqual(res.body.length > 0, true);
            assert.deepEqual(/Redirect Target/.test(res.body.toString()), false);
        });
    });

    it('should return 200 for redirect pages html with no-cache', function() {
        return preq.get({
            uri: server.config.labsBucketURL + '/html/User:Pchelolo%2fRedirect_Test',
            headers: {
                'cache-control': 'no-cache'
            },
            followRedirect: false
        })
        .then(function(res) {
            assert.deepEqual(res.status, 200);
            assert.deepEqual(res.headers.location, undefined);
            assert.deepEqual(res.body.length > 0, true);
            assert.deepEqual(/Redirect Target/.test(res.body.toString()), false);
        });
    });

    it('should return 302 for redirect pages html with revision', function() {
        return preq.get({
            uri: server.config.labsBucketURL + '/html/User:Pchelolo%2fRedirect_Test/331630',
            followRedirect: false
        })
        .then(function(res) {
            assert.deepEqual(res.status, 302);
            assert.deepEqual(res.headers.location, '../User%3APchelolo%2FRedirect_Target_%25');
            assert.deepEqual(res.headers['cache-control'], 'test_purged_cache_control');
            assert.deepEqual(res.body.length > 0, true);
            assert.deepEqual(/Redirect Target/.test(res.body.toString()), false);
        });
    });

    it('should return 200 for redirect pages html with revision, redirect=no', function() {
        return preq.get({
            uri: server.config.labsBucketURL + '/html/User:Pchelolo%2fRedirect_Test/331630?redirect=no',
            followRedirect: false
        })
        .then(function(res) {
            assert.deepEqual(res.status, 200);
            assert.deepEqual(res.headers.location, undefined);
            assert.deepEqual(res.body.length > 0, true);
            assert.deepEqual(/Redirect Target/.test(res.body.toString()), false);
        });
    });

    it('should return 302 for redirect pages summary', function() {
        return preq.get({
            uri: server.config.labsBucketURL + '/summary/User:Pchelolo%2fRedirect_Test',
            followRedirect: false
        })
        .then(function(res) {
            assert.deepEqual(res.status, 302);
            assert.deepEqual(res.headers.location, 'User%3APchelolo%2FRedirect_Target_%25');
            assert.deepEqual(res.headers['cache-control'], 'test_purged_cache_control_with_client_caching');
            assert.deepEqual(res.body.length, 0);
        });
    });

    it('should return 302 for redirect pages mobile-sections', function() {
        return preq.get({
            uri: server.config.labsBucketURL + '/mobile-sections/User:Pchelolo%2fRedirect_Test',
            followRedirect: false
        })
        .then(function(res) {
            assert.deepEqual(res.status, 302);
            assert.deepEqual(res.headers.location, 'User%3APchelolo%2FRedirect_Target_%25');
            assert.deepEqual(res.headers['cache-control'], 'test_purged_cache_control');
            assert.deepEqual(res.body.length, 0);
        });
    });

    it('should return 302 for redirect pages mobile-sections-lead', function() {
        return preq.get({
            uri: server.config.labsBucketURL + '/mobile-sections-lead/User:Pchelolo%2fRedirect_Test',
            followRedirect: false
        })
        .then(function(res) {
            assert.deepEqual(res.status, 302);
            assert.deepEqual(res.headers.location, 'User%3APchelolo%2FRedirect_Target_%25');
            assert.deepEqual(res.headers['cache-control'], 'test_purged_cache_control');
            assert.deepEqual(res.body.length, 0);
        });
    });

    it('should return 302 for redirect pages mobile-sections-remaining', function() {
        return preq.get({
            uri: server.config.labsBucketURL + '/mobile-sections-remaining/User:Pchelolo%2fRedirect_Test',
            followRedirect: false
        })
        .then(function(res) {
            assert.deepEqual(res.status, 302);
            assert.deepEqual(res.headers.location, 'User%3APchelolo%2FRedirect_Target_%25');
            assert.deepEqual(res.headers['cache-control'], 'test_purged_cache_control');
            assert.deepEqual(res.body.length, 0);
        });
    });

    it('should attach correct content-location', () => {
        return preq.get({
            uri: server.config.bucketURL + '/html/Main_Page'
        })
        .then((res) => {
            assert.deepEqual(res.status, 200);
            assert.deepEqual(res.headers['content-location'], 'https://en.wikipedia.org/api/rest_v1/page/html/Main_Page');
        })
    });

    it('should return 200 for redirect pages html, cross-origin', function() {
        return preq.get({
            uri: server.config.labsBucketURL + '/html/User:Pchelolo%2fRedirect_Test',
            headers: {
                origin: 'test.com'
            },
            followRedirect: false
        })
        .then(function(res) {
            assert.deepEqual(res.status, 200);
            assert.deepEqual(res.headers['content-location'],
                'https://en.wikipedia.beta.wmflabs.org/api/rest_v1/page/html/User%3APchelolo%2FRedirect_Target_%25');
            assert.deepEqual(res.headers['cache-control'], 'no-cache');
            assert.deepEqual(res.body.length > 0, true);
            assert.deepEqual(/Redirect Target/.test(res.body.toString()), true);
        });
    });

    it('should return 200 for redirect pages html, cross-origin, with title normalization', function() {
        return preq.get({
            uri: server.config.labsBucketURL + '/html/User:Pchelolo%2fRedirect%20Test',
            headers: {
                origin: 'test.com'
            },
            followRedirect: false
        })
        .then(function(res) {
            assert.deepEqual(res.status, 200);
            assert.deepEqual(res.headers['content-location'],
                'https://en.wikipedia.beta.wmflabs.org/api/rest_v1/page/html/User%3APchelolo%2FRedirect_Target_%25');
            assert.deepEqual(res.headers['cache-control'], 'no-cache');
            assert.deepEqual(res.body.length > 0, true);
            assert.deepEqual(/Redirect Target/.test(res.body.toString()), true);
        });
    });

    it('should redirect to commons for missing file pages, cross-origin', function() {
        return preq.get({
            uri: server.config.bucketURL + '/html/File:ThinkingMan_Rodin.jpg',
            headers: {
                origin: 'test.com'
            },
            followRedirect: false
        })
        .then(function(res) {
            assert.deepEqual(res.status, 200);
            assert.deepEqual(res.headers['content-location'],
                'https://commons.wikimedia.org/api/rest_v1/page/html/File%3AThinkingMan_Rodin.jpg');
            assert.deepEqual(res.headers['cache-control'], 'no-cache');
        });
    });

    it('should stop redirect cycles, cross-origin', function() {
        return preq.get({
            uri: server.config.labsBucketURL + '/html/User:Pchelolo%2fRedirect_Test_One',
            headers: {
                origin: 'test.com'
            },
            followRedirect: false
        })
        .then(() => {
            throw new Error('Error must be thrown');
        }, (e) => {
            assert.deepEqual(e.status, 504);
            assert.deepEqual(/Exceeded maxRedirects/.test(e.body.detail), true);
        });
    });
    });
});
