'use strict';

// mocha defines to avoid JSHint breakage
/* global describe, it, before */

// These tests are derived from https://phabricator.wikimedia.org/T75955,
// section 'On-demand generation of HTML and data-parsoid'

const assert = require('../../../utils/assert.js');
const server = require('../../../utils/server.js');
const preq   = require('preq');
const mwUtil = require('../../../../lib/mwUtil');

const revA = '275843';
const revB = '275844';
const revC = '275845';
const title = 'User:Pchelolo%2fOnDemand_Test';
const pageUrl = server.config.labsBucketURL;

describe('on-demand generation of html and data-parsoid', function() {
    this.timeout(20000);

    before(() => { return server.start(); });

    const contentTypes = server.config.conf.test.content_types;

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

    it('should transparently create revision B via Parsoid', () => {
        const slice = server.config.logStream.slice();
        return preq.get({
            uri: `${pageUrl}/html/${title}/${revB}`,
        })
        .then((res) => {
            slice.halt();
            assert.contentType(res, contentTypes.html);
            assert.deepEqual(typeof res.body, 'string');
            assert.localRequests(slice, false);
            assert.remoteRequests(slice, true);
            revBETag = res.headers.etag.replace(/^"(.*)"$/, '$1');
        });
    });

    let revBETag;
    it('should retrieve html revision B from storage', () => {
        const slice = server.config.logStream.slice();
        return preq.get({
            uri: `${pageUrl}/html/${title}/${revB}`,
        })
        // .delay(2000)
        .then((res) => {
            slice.halt();
            assert.contentType(res, contentTypes.html);
            assert.deepEqual(typeof res.body, 'string');
            assert.deepEqual(res.headers.etag.replace(/^"(.*)"$/, '$1'), revBETag);
            // assert.localRequests(slice, true);
            // assert.remoteRequests(slice, false);
        });
    });

    it('should retrieve data-parsoid revision B from storage', () => {
        const slice = server.config.logStream.slice();
        return preq.get({
            uri: `${pageUrl}/data-parsoid/${title}/${revBETag}`
        })
        // .delay(500)
        .then((res) => {
            slice.halt();
            assert.contentType(res, contentTypes['data-parsoid']);
            assert.deepEqual(typeof res.body, 'object');
            assert.deepEqual(res.headers.etag.replace(/^"(.*)"$/, '$1'), revBETag);
            // assert.localRequests(slice, true);
            // assert.remoteRequests(slice, false);
        });
    });

    it('should pass (stored) html revision B to Parsoid for cache-control:no-cache',
        () => {
        // Start watching for new log entries
            const slice = server.config.logStream.slice();
            return preq.get({
                uri: `${pageUrl}/html/${title}/${revB}`,
                headers: {
                    'cache-control': 'no-cache'
                },
            })
        .then((res) => {
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

    it.skip('should pass (stored) revision B content to Parsoid for image update',
        () => {
        // Start watching for new log entries
            const slice = server.config.logStream.slice();
            return preq.get({
                uri: `${pageUrl}/html/${title}/${revB}`,
                headers: {
                    'cache-control': 'no-cache',
                    'x-restbase-mode': 'images'
                },
            })
        .then((res) => {
            // Stop watching for new log entries
            slice.halt();
            assert.contentType(res, contentTypes.html);
            if (!/<html/.test(res.body)) {
                throw new Error("Expected html content!");
            }
            assert.localRequests(slice, false);
            assert.remoteRequests(slice, true);
            const parsoidRequest = assert.findParsoidRequest(slice);
            assert.deepEqual(parsoidRequest.method, 'post');
            const prBody = parsoidRequest.body;
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

    it.skip('should pass (stored) revision B content to Parsoid for edit update',
        () => {
        // Start watching for new log entries
            const slice = server.config.logStream.slice();
            return preq.get({
                uri: `${pageUrl}/html/${title}/${revC}`,
                headers: {
                    'cache-control': 'no-cache',
                    'x-restbase-parentrevision': revB
                },
            })
        .then((res) => {
            // Stop watching for new log entries
            slice.halt();
            assert.contentType(res, contentTypes.html);
            if (!/<html/.test(res.body)) {
                throw new Error("Expected html content!");
            }
            assert.localRequests(slice, false);
            assert.remoteRequests(slice, true);
            const parsoidRequest = assert.findParsoidRequest(slice);
            assert.deepEqual(parsoidRequest.method, 'post');
            const prBody = parsoidRequest.body;
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

    it('should return correct Content-Security-Policy header', () => {
        return preq.get({
            uri: `${pageUrl}/html/${title}`
        })
        .then((res) => {
            assert.deepEqual(!!res.headers['content-security-policy'], true);
            assert.deepEqual(res.headers['content-security-policy']
                .indexOf("style-src http://*.wikipedia.beta.wmflabs.org https://*.wikipedia.beta.wmflabs.org 'unsafe-inline'") > 0, true);
        });
    });

    it('should honor no-cache on /html/{title} endpoint', () => {
        const testPage = "User:Pchelolo%2fRev_Test";
        const firstRev = 275846;
        // 1. Pull in a non-final revision of a title
        return preq.get({
            uri: `${pageUrl}/html/${testPage}/${firstRev}`
        })
        .then((res) => {
            assert.deepEqual(res.status, 200);
            assert.deepEqual(/First Revision/.test(res.body), true);
            return preq.get({
                uri: `${pageUrl}/html/${testPage}`,
                headers: {
                    'cache-control': 'no-cache'
                }
            });
        })
        .then((res) => {
            assert.deepEqual(res.status, 200);
            assert.deepEqual(/Second Revision/.test(res.body), true);
        });
    });

    it('should honor no-cache on /html/{title} endpoint with sections', () => {
        const testPage = "User:Pchelolo%2fRev_Section_Test";
        const firstRev = 275848;
        // 1. Pull in a non-final revision of a title
        return preq.get({
            uri: `${pageUrl}/html/${testPage}/${firstRev}`
        })
        .then((res) => {
            assert.deepEqual(res.status, 200);
            assert.deepEqual(/First Revision/.test(res.body), true);
            return preq.get({
                uri: `${pageUrl}/data-parsoid/${testPage}/${firstRev}/${mwUtil.parseETag(res.headers.etag).tid}`
            });
        })
        .then((res) => {
            const sections = Object.keys(res.body.sectionOffsets).join(',');
            return preq.get({
                uri: `${pageUrl}/html/${testPage}?sections=${sections}`,
                headers: {
                    'cache-control': 'no-cache'
                }
            });
        })
        .then((res) => {
            assert.deepEqual(res.status, 200);
            assert.deepEqual(res.headers['cache-control'], 'no-cache');
            assert.deepEqual(/Second Revision/.test(res.body.mwAQ), true);
        });
    });
});
