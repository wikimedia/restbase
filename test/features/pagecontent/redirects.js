'use strict';

// mocha defines to avoid JSHint breakage
/* global describe, it, before, beforeEach, after, afterEach */

var mwUtil = require('../../../lib/mwUtil');
var assert = require('../../utils/assert.js');
var preq   = require('preq');
var server = require('../../utils/server.js');
var nock = require('nock');

describe('Redirects', function() {
    before(function() { return server.start(); });

    it('should redirect to a normalized version of a title', function() {
        return preq.get({
            uri: server.config.bucketURL + '/html/Main%20Page?test=mwAQ',
            followRedirect: false
        })
        .then(function(res) {
            assert.deepEqual(res.status, 301);
            assert.deepEqual(res.headers['location'], 'Main_Page?test=mwAQ');
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
            uri: server.config.bucketURL + '/html/File:ThinkingMan_Rodin.jpg'
        })
        .then(function(res) {
            assert.deepEqual(res.status, 200);
            assert.deepEqual(res.headers['content-location'],
                'https://commons.wikimedia.org/api/rest_v1/page/html/File%3AThinkingMan_Rodin.jpg');
        });
    });

    it('should redirect to commons for missing file pages, dewiki', function() {
        return preq.get({
            uri: server.config.hostPort + '/de.wikipedia.org/v1/page/html/Datei:Name.jpg'
        })
        .then(function(res) {
            assert.deepEqual(res.status, 200);
            assert.deepEqual(res.headers['content-location'],
                'https://commons.wikimedia.org/api/rest_v1/page/html/File%3AName.jpg');
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
                'https://en.wikipedia.org/api/rest_v1/html/User:Pchelolo%2fRedirect_Test2?redirect=false')
            assert.deepEqual(res.body.length > 0, true);
        });
    });

    var etag;
    it('should return 302 for redirect pages html', function() {
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
            etag = res.headers.etag;
        });
    });

    it('should return 302 for redirect pages data-parsoid', function() {
        assert.notDeepEqual(etag, undefined);
        var renderInfo = mwUtil.parseETag(etag);
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
            assert.deepEqual(res.headers['cache-control'], 'test_purged_cache_control');
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
            assert.deepEqual(res.body.length, 0);
        });
    });

    it('should attach correct content-location', () => {
        return preq.get({
            uri: server.config.bucketURL + '/html/Main_Page'
        })
        .then((res) => {
            assert.deepEqual(res.status, 200);
            assert.deepEqual(res.headers['content-location'], 'https://en.wikipedia.org/api/rest_v1/html/Main_Page')
        })
    });
});
