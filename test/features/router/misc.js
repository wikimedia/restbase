'use strict';

const assert = require('../../utils/assert.js');
const preq   = require('preq');
const Server = require('../../utils/server.js');

function getHeader(res, name) {
    if (res.rawHeaders.indexOf(name) === -1) {
        return undefined;
    }
    return res.rawHeaders[res.rawHeaders.indexOf(name) + 1];
}

describe('router - misc', function() {
    this.timeout(100000);
    const server = new Server();
    before(() => server.start());
    after(() => server.stop());

    it('should deny access to /{domain}/sys', () => {
        return preq.get({uri: `${server.config.hostPort}/en.wikipedia.org/sys/action/query`})
        .catch((err) => {
            assert.deepEqual(err.status, 403);
        });
    });

    it('should set a request ID for each sub-request and return it', () => {
        assert.recordRequests();
        return preq.get({
            uri: `${server.config.bucketURL('en.wikipedia.beta.wmflabs.org')}/html/Foobar`,
            headers: {
                'Cache-Control': 'no-cache'
            }
        })
        .then((res) => {
            const reqId = res.headers['x-request-id'];
            assert.notDeepEqual(reqId, undefined, 'Request ID not returned');
            assert.findRequests(() => {}).forEach((req) => {
                assert.deepEqual(req.headers['x-request-id'], reqId, 'Request ID mismatch');
            });
        })
        .finally(() => assert.cleanupRecorder());
    });

    it('should honour the provided request ID', () => {
        assert.recordRequests();
        const reqId = 'b6c17ea83d634b31bb28d60aae1caaac';
        return preq.get({
            uri: `${server.config.bucketURL('en.wikipedia.beta.wmflabs.org')}/html/Foobar`,
            headers: {
                'X-Request-Id': reqId
            }
        }).then((res) => {
            assert.deepEqual(res.headers['x-request-id'], reqId, 'Returned request ID does not match the sent one');
            assert.findRequests(() => true).forEach((req) => {
                assert.deepEqual(getHeader(req, 'x-request-id'), reqId, 'Request ID mismatch');
            });
        })
        .finally(() => assert.cleanupRecorder());
    });

    it('should set the request ID for a 404', () => {
        const reqId = '9c54ff673d634b31bb28d60aae1cb43c';
        assert.recordRequests();
        return preq.get({
            uri: `${server.config.bucketURL('en.wikipedia.beta.wmflabs.org')}/foo-bucket/Foobar`,
            headers: {
                'X-Request-Id': reqId
            }
        }).then((res) => {
            throw new Error(`Expected a 404, got ${res.status}`);
        }, (err) => {
            assert.deepEqual(err.headers['x-request-id'], reqId, 'Returned request ID does not match the sent one');
            assert.findRequests(() => true).forEach((req) => {
                assert.deepEqual(getHeader(req, 'x-request-id'), reqId, 'Request ID mismatch');
            });
        })
        .finally(() => assert.cleanupRecorder());
    });

    it('should truncate body upon HEAD request', () => {
        return preq.head({
            uri: `${server.config.bucketURL('en.wikipedia.beta.wmflabs.org')}/html/Foobar`
        })
        .then((res) => {
            assert.deepEqual(res.status, 200);
            assert.deepEqual(res.headers['content-length'], undefined);
            assert.deepEqual(res.body, '');
        });
    });
});
