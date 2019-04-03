'use strict';

const assert = require('../../utils/assert.js');
const Server = require('../../utils/server.js');
const preq   = require('preq');
const P = require('bluebird');

describe('handler template', function() {
    this.timeout(20000);
    const server = new Server();
    before(() => server.start());
    after(() => server.stop());

    function hasTextContentType(res) {
        assert.deepEqual(/^text\/html/.test(res.headers['content-type']), true);
    }

    it('retrieve content from backend service', () => {
        return preq.get({
            uri: `${server.config.baseURL()}/service/test/User:GWicke%2fDate`
        })
        .then((res) => {
            assert.deepEqual(res.status, 200);
            hasTextContentType(res);

            // Delay for 1s to make sure that the content differs on
            // re-render, then force a re-render and check that it happened.
            assert.recordRequests();
            return P.delay(1100)
            .then(() => {
                return preq.get({
                    uri: `${server.config.baseURL()}/service/test/User:GWicke%2fDate`,
                    headers: { 'cache-control': 'no-cache' }
                });
            });
        })
        .then((res) => {
            hasTextContentType(res);
            assert.remoteRequests(true);
            assert.cleanupRecorder();
            // delay for 1s to let the content change on re-render
            // Check retrieval of a stored render
            return P.delay(1100)
            .then(() => {
                return preq.get({
                    uri: `${server.config.baseURL()}/service/test/User:GWicke%2fDate`,
                });
            });
        })
        .then((res) => {
            // Check that there were no remote requests
            assert.remoteRequests(false);
            hasTextContentType(res);
        }).tapCatch(console.log);
    });
});
