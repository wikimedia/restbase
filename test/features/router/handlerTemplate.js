'use strict';

// mocha defines to avoid JSHint breakage
/* global describe, it, before */

const assert = require('../../utils/assert.js');
const server = require('../../utils/server.js');
const preq   = require('preq');
const P = require('bluebird');

describe('handler template', function() {
    this.timeout(20000);

    before(() => { return server.start(); });

    // A test page that includes the current date, so that it changes if
    // re-rendered more than a second apart.
    const testPage = `${server.config.baseURL}/service/test/User:GWicke%2fDate`;

    function hasTextContentType(res) {
        assert.deepEqual(/^text\/html/.test(res.headers['content-type']), true);
    }

    let slice;

    it('retrieve content from backend service', () => {
        let tid1;
        let tid2;
        return preq.get({
            uri: testPage
        })
        .then((res) => {
            assert.deepEqual(res.status, 200);
            tid1 = res.headers.etag;
            hasTextContentType(res);

            // Delay for 1s to make sure that the content differs on
            // re-render, then force a re-render and check that it happened.
            slice = server.config.logStream.slice();
            return P.delay(1100)
            .then(() => {
                return preq.get({
                    uri: testPage,
                    headers: { 'cache-control': 'no-cache' }
                });
            });
        })
        .then((res) => {
            tid2 = res.headers.etag;
            assert.notDeepEqual(tid2, tid1);
            assert.notDeepEqual(tid2, undefined);
            hasTextContentType(res);
            slice.halt();
            assert.remoteRequests(slice, true);
            // delay for 1s to let the content change on re-render
            slice = server.config.logStream.slice();

            // Check retrieval of a stored render
            return P.delay(1100)
            .then(() => {
                return preq.get({
                    uri: testPage,
                });
            });
        })
        .then((res) => {
            const tid3 = res.headers.etag;
            assert.deepEqual(tid3, tid2);
            assert.notDeepEqual(tid3, undefined);
            // Check that there were no remote requests
            slice.halt();
            assert.remoteRequests(slice, false);
            hasTextContentType(res);
        });
    });
});
