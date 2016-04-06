'use strict';

// mocha defines to avoid JSHint breakage
/* global describe, it, before, beforeEach, after, afterEach */

var assert = require('../../utils/assert.js');
var preq   = require('preq');
var server = require('../../utils/server.js');
var P      = require('bluebird');

describe('Redirects', function() {
    before(function() { return server.start(); });

    it('should redirect to commons for missing file pages', function() {
        return preq.get({
            uri: server.config.bucketURL + '/html/File:ThinkingMan_Rodin.jpg',
            headers: {
                'user-agent': 'WikipediaApp/2.1.141-beta-2016-02-10 (Android 5.0.2; Phone) Google Play Beta Channel'
            }
        })
        .then(function(res) {
            assert.deepEqual(res.status, 200);
            assert.deepEqual(res.headers['content-location'],
            'https://commons.wikimedia.org/api/rest_v1/page/html/File%3AThinkingMan_Rodin.jpg');
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

    it('should return 302 for redirect pages html', function() {
        return preq.get({
            uri: server.config.labsBucketURL + '/html/User:Pchelolo%2fRedirect_Test',
            followRedirect: false
        })
        .then(function(res) {
            assert.deepEqual(res.status, 302);
            assert.deepEqual(res.headers.location, 'User%3APchelolo%2FRedirect_Target_%25');
            assert.deepEqual(res.headers['cache-control'], 'test_purged_cache_control');
            assert.deepEqual(/Redirect Target/.test(res.body.toString()), false);
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
            assert.deepEqual(res.headers.location, '../User%3APchelolo%2FRedirect_Target_%25/331630');
            assert.deepEqual(res.headers['cache-control'], 'test_purged_cache_control');
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
            assert.deepEqual(res.body, {
                title: 'User:Pchelolo/Redirect Test',
                extract: '',
                lang: 'en',
                dir: 'ltr'
            });
        });
    });

    /* TODO disabled until mobileapps fix their on entities decoding.
    it('should return 302 for redirect pages mobile-sections', function() {
        return preq.get({
            uri: server.config.labsBucketURL + '/mobile-sections/User:Pchelolo%2fRedirect_Test',
            followRedirect: false
        })
        .then(function(res) {
            assert.deepEqual(res.status, 302);
            assert.deepEqual(res.headers.location, 'User%3APchelolo%2FRedirect_Target_%25');
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
        });
    });
    */
});
