'use strict';

// mocha defines to avoid JSHint breakage
/* global describe, it, before, beforeEach, after, afterEach */

// These tests are derived from https://phabricator.wikimedia.org/T75955,
// section 'On-demand generation of HTML and data-parsoid'

var assert = require('../../../utils/assert.js');
var server = require('../../../utils/server.js');
var preq   = require('preq');

var revA = '275843';
var revB = '275844';
var revC = '275845';
var title = 'User:Pchelolo%2fOnDemand_Test';
var pageUrl = server.config.labsBucketURL;

describe('on-demand generation of html and data-parsoid', function() {
    this.timeout(20000);

    before(function () { return server.start(); });

    var contentTypes = server.config.conf.test.content_types;

    /**
     * Disabled, as there is really not much of a use case for fetching
     * data-parsoid without also fetching the corresponding HTML, and we have
     * made the tid compulsory to avoid clients making the mistake of
     * requesting a different render of data-parsoid.
     *
    it('should transparently create revision A via Parsoid', function () {
        var slice = server.config.logStream.slice();
        return preq.get({
            uri: pageUrl + '/data-parsoid/' + title + '/' + revA,
        })
        .then(function (res) {
            slice.halt();
            assert.contentType(res, contentTypes['data-parsoid']);
            assert.deepEqual(typeof res.body, 'object');
            assert.localRequests(slice, false);
            assert.remoteRequests(slice, true);
        });
    });
    */

    it('should transparently create revision B via Parsoid', function () {
        var slice = server.config.logStream.slice();
        return preq.get({
            uri: pageUrl + '/html/' + title + '/' + revB,
        })
        .then(function (res) {
            slice.halt();
            assert.contentType(res, contentTypes.html);
            assert.deepEqual(typeof res.body, 'string');
            assert.localRequests(slice, false);
            assert.remoteRequests(slice, true);
            revBETag = res.headers.etag.replace(/^"(.*)"$/, '$1');
        });
    });

    var revBETag;
    it('should retrieve html revision B from storage', function () {
        var slice = server.config.logStream.slice();
        return preq.get({
            uri: pageUrl + '/html/' + title + '/' + revB,
        })
        // .delay(2000)
        .then(function (res) {
            slice.halt();
            assert.contentType(res, contentTypes.html);
            assert.deepEqual(typeof res.body, 'string');
            assert.deepEqual(res.headers.etag.replace(/^"(.*)"$/, '$1'), revBETag);
            // assert.localRequests(slice, true);
            // assert.remoteRequests(slice, false);
        });
    });

    it('should retrieve data-parsoid revision B from storage', function () {
        var slice = server.config.logStream.slice();
        return preq.get({
            uri: pageUrl + '/data-parsoid/' + title + '/' + revBETag
        })
        // .delay(500)
        .then(function (res) {
            slice.halt();
            assert.contentType(res, contentTypes['data-parsoid']);
            assert.deepEqual(typeof res.body, 'object');
            assert.deepEqual(res.headers.etag.replace(/^"(.*)"$/, '$1'), revBETag);
            // assert.localRequests(slice, true);
            // assert.remoteRequests(slice, false);
        });
    });

    it('should pass (stored) html revision B to Parsoid for cache-control:no-cache',
    function () {
        // Start watching for new log entries
        var slice = server.config.logStream.slice();
        return preq.get({
            uri: pageUrl + '/html/' + title + '/' + revB,
            headers: {
                'cache-control': 'no-cache'
            },
        })
        .then(function (res) {
            // Stop watching for new log entries
            slice.halt();
            assert.contentType(res, contentTypes.html);
            assert.deepEqual(typeof res.body, 'string');
            assert.localRequests(slice, false);
            assert.remoteRequests(slice, true);
        });
    });

    /**
     * We always update html as the primary content, and have made the tid
     * mandatory for data-parsoid requests. Hence, disable this test.
     *
    it('should pass (stored) revision B content to Parsoid for template update',
    function () {
        // Start watching for new log entries
        var slice = server.config.logStream.slice();
        return preq.get({
            uri: pageUrl + '/data-parsoid/' + title + '/' + revB,
            headers: {
                'cache-control': 'no-cache',
                'x-restbase-mode': 'templates'
            },
        })
        .then(function (res) {
            // Stop watching for new log entries
            slice.halt();
            assert.contentType(res, contentTypes['data-parsoid']);
            assert.deepEqual(typeof res.body, 'object');
            assert.localRequests(slice, false);
            assert.remoteRequests(slice, true);
            var parsoidRequest = assert.findParsoidRequest(slice);
            assert.deepEqual(parsoidRequest.method, 'post');
            var prBody = parsoidRequest.body;
            assert.deepEqual(prBody.update, 'templates');
            assert.deepEqual(prBody.original.revid, revB);
            if (!prBody.original.html.body) {
                throw new Error('Missing original html body in parsoid request');
            }
            if (!prBody.original['data-parsoid'].body) {
                throw new Error('Missing original html body in parsoid request');
            }
        });
    });
    */

    it('should pass (stored) revision B content to Parsoid for image update',
    function () {
        // Start watching for new log entries
        var slice = server.config.logStream.slice();
        return preq.get({
            uri: pageUrl + '/html/' + title + '/' + revB,
            headers: {
                'cache-control': 'no-cache',
                'x-restbase-mode': 'images'
            },
        })
        .then(function (res) {
            // Stop watching for new log entries
            slice.halt();
            assert.contentType(res, contentTypes.html);
            if (!/<html/.test(res.body)) {
                throw new Error("Expected html content!");
            }
            assert.localRequests(slice, false);
            assert.remoteRequests(slice, true);
            var parsoidRequest = assert.findParsoidRequest(slice);
            assert.deepEqual(parsoidRequest.method, 'post');
            var prBody = parsoidRequest.body;
            assert.deepEqual(prBody.update, 'images');
            assert.deepEqual(prBody.original.revid, revB);
            if (!prBody.original.html.body) {
                throw new Error('Missing original html body in parsoid request');
            }
            if (!prBody.original['data-parsoid'].body) {
                throw new Error('Missing original html body in parsoid request');
            }
        });
    });

    it('should pass (stored) revision B content to Parsoid for edit update',
    function () {
        // Start watching for new log entries
        var slice = server.config.logStream.slice();
        return preq.get({
            uri: pageUrl + '/html/' + title + '/' + revC,
            headers: {
                'cache-control': 'no-cache',
                'x-restbase-parentrevision': revB
            },
        })
        .then(function (res) {
            // Stop watching for new log entries
            slice.halt();
            assert.contentType(res, contentTypes.html);
            if (!/<html/.test(res.body)) {
                throw new Error("Expected html content!");
            }
            assert.localRequests(slice, false);
            assert.remoteRequests(slice, true);
            var parsoidRequest = assert.findParsoidRequest(slice);
            assert.deepEqual(parsoidRequest.method, 'post');
            var prBody = parsoidRequest.body;
            assert.deepEqual(prBody.update, undefined);
            assert.deepEqual(prBody.previous.revid, revB);
            if (!prBody.previous.html.body) {
                throw new Error('Missing original html body in parsoid request');
            }
            if (!prBody.previous['data-parsoid'].body) {
                throw new Error('Missing original html body in parsoid request');
            }
        });
    });

    it('should return correct Content-Security-Policy header', function () {
        return preq.get({
            uri: pageUrl + '/html/' + title
        })
        .then(function (res) {
            assert.deepEqual(!!res.headers['content-security-policy'], true);
            assert.deepEqual(res.headers['content-security-policy']
                .indexOf("style-src http://*.wikipedia.beta.wmflabs.org https://*.wikipedia.beta.wmflabs.org 'unsafe-inline'") > 0, true);
        });
    });

    it('should honor no-cache on /html/{title} endpoint', function() {
        var testPage = "User:Pchelolo%2fRev_Test";
        var firstRev = 275846;
        // 1. Pull in a non-final revision of a title
        return preq.get({
            uri: pageUrl + '/html/' + testPage + '/' + firstRev
        })
        .then(function(res) {
            assert.deepEqual(res.status, 200);
            assert.deepEqual(/First Revision/.test(res.body), true);
            return preq.get({
                uri: pageUrl + '/html/' + testPage,
                headers: {
                    'cache-control': 'no-cache'
                }
            });
        })
        .then(function(res) {
            assert.deepEqual(res.status, 200);
            assert.deepEqual(/Second Revision/.test(res.body), true);
        })
    });

    it('should honor no-cache on /html/{title} endpoint with sections', function() {
        var testPage = "User:Pchelolo%2fRev_Section_Test";
        var firstRev = 275848;
        // 1. Pull in a non-final revision of a title
        return preq.get({
            uri: pageUrl + '/html/' + testPage + '/' + firstRev
        })
        .then(function(res) {
            assert.deepEqual(res.status, 200);
            assert.deepEqual(/First Revision/.test(res.body), true);
            return preq.get({
                uri: pageUrl + '/html/' + testPage + '?sections=mwAQ',
                headers: {
                    'cache-control': 'no-cache'
                }
            });
        })
        .then(function(res) {
            assert.deepEqual(res.status, 200);
            assert.deepEqual(res.headers['cache-control'], 'no-cache');
            assert.deepEqual(/Second Revision/.test(res.body.mwAQ), true);
        })
    });
});
