'use strict';

// These tests are derived from https://phabricator.wikimedia.org/T75955,
// section 'On-demand generation of HTML and data-parsoid'

const assert = require('../../../utils/assert.js');
const Server = require('../../../utils/server.js');
const preq   = require('preq');
const mwUtil = require('../../../../lib/mwUtil');
const uuidv1   = require('uuid');

const revB = '275844';
const revC = '275845';
const title = 'User:Pchelolo%2fOnDemand_Test';

describe('on-demand generation of html and data-parsoid', function() {
    this.timeout(20000);
    let contentTypes;
    let revBETag;
    const server = new Server();
    before(() => server.start()
    .then(() => {
        contentTypes = server.config.conf.test.content_types;
    }));
    after(() =>  server.stop());

    it('should transparently create revision B via Parsoid', () => {
        assert.recordRequests();
        return preq.get({
            uri: `${server.config.bucketURL('en.wikipedia.beta.wmflabs.org')}/html/${title}/${revB}`,
        })
        .then((res) => {
            assert.contentType(res, contentTypes.html);
            assert.deepEqual(typeof res.body, 'string');
            assert.remoteRequests(true);
            revBETag = res.headers.etag.replace(/^"(.*)"$/, '$1');
        })
        .finally(() => assert.cleanupRecorder());
    });

    it('should not transparently create revision B via Parsoid if TID is provided', () => {
        return preq.get({
            uri: `${server.config.bucketURL('en.wikipedia.beta.wmflabs.org')}/html/${title}/${revB}/${uuidv1()}`,
        })
        .then(() => {
            throw new Error('404 should have been thrown');
        }, (e) => {
            assert.deepEqual(e.status, 404);
        });
    });

    it('should retrieve html revision B from storage', () => {
        assert.recordRequests();
        return preq.get({
            uri: `${server.config.bucketURL('en.wikipedia.beta.wmflabs.org')}/html/${title}/${revB}`,
        })
        .then((res) => {
            assert.contentType(res, contentTypes.html);
            assert.deepEqual(typeof res.body, 'string');
            assert.deepEqual(res.headers.etag.replace(/^"(.*)"$/, '$1'), revBETag);
            assert.remoteRequests(false);
        })
        .finally(() => assert.cleanupRecorder());
    });

    it('should retrieve data-parsoid revision B from storage', () => {
        assert.recordRequests();
        return preq.get({
            uri: `${server.config.bucketURL('en.wikipedia.beta.wmflabs.org')}/data-parsoid/${title}/${revBETag}`
        })
        .then((res) => {
            assert.contentType(res, contentTypes['data-parsoid']);
            assert.deepEqual(typeof res.body, 'object');
            assert.deepEqual(res.headers.etag.replace(/^"(.*)"$/, '$1'), revBETag);
            assert.remoteRequests(false);
        })
        .finally(() => assert.cleanupRecorder());
    });

    it('should pass (stored) html revision B to Parsoid for cache-control:no-cache', () => {
        assert.recordRequests();
        return preq.get({
            uri: `${server.config.bucketURL('en.wikipedia.beta.wmflabs.org')}/html/${title}/${revB}`,
            headers: {
                'cache-control': 'no-cache'
            },
        })
        .then((res) => {
            assert.contentType(res, contentTypes.html);
            assert.deepEqual(typeof res.body, 'string');
            assert.remoteRequests(true);
        })
        .finally(() => assert.cleanupRecorder());
    });

    it.skip('should pass (stored) revision B content to Parsoid for image update', () => {
        // Start watching for new log entries
        assert.recordRequests();
        return preq.get({
            uri: `${server.config.bucketURL('en.wikipedia.beta.wmflabs.org')}/html/${title}/${revB}`,
            headers: {
                'cache-control': 'no-cache',
                'x-restbase-mode': 'images'
            },
        })
        .then((res) => {
            // Stop watching for new log entries
            assert.contentType(res, contentTypes.html);
            if (!/<html/.test(res.body)) {
                throw new Error("Expected html content!");
            }
            assert.remoteRequests(true);
            const parsoidRequest = assert.findParsoidRequest();
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
        })
        .finally(() => assert.cleanupRecorder());
    });

    it.skip('should pass (stored) revision B content to Parsoid for edit update', () => {
        // Start watching for new log entries
        assert.recordRequests();
        return preq.get({
            uri: `${server.config.bucketURL('en.wikipedia.beta.wmflabs.org')}/html/${title}/${revC}`,
            headers: {
                'cache-control': 'no-cache',
                'x-restbase-parentrevision': revB
            },
        })
        .then((res) => {
            // Stop watching for new log entries
            assert.contentType(res, contentTypes.html);
            if (!/<html/.test(res.body)) {
                throw new Error("Expected html content!");
            }
            assert.remoteRequests(true);
            const parsoidRequest = assert.findParsoidRequest();
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
        })
        .finally(() => assert.cleanupRecorder());
    });

    it('should return correct Content-Security-Policy header', () => {
        return preq.get({
            uri: `${server.config.bucketURL('en.wikipedia.beta.wmflabs.org')}/html/${title}`
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
            uri: `${server.config.bucketURL('en.wikipedia.beta.wmflabs.org')}/html/${testPage}/${firstRev}`
        })
        .then((res) => {
            assert.deepEqual(res.status, 200);
            assert.deepEqual(/First Revision/.test(res.body), true);
            return preq.get({
                uri: `${server.config.bucketURL('en.wikipedia.beta.wmflabs.org')}/html/${testPage}`,
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
});
