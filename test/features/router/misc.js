'use strict';

// mocha defines to avoid JSHint breakage
/* global describe, it, before */

const assert = require('../../utils/assert.js');
const preq   = require('preq');
const server = require('../../utils/server.js');

describe('router - misc', function() {

    this.timeout(20000);

    before(() => { return server.start(); });

    it('should deny access to /{domain}/sys', () => {
        return preq.get({
            uri: `${server.config.hostPort}/en.wikipedia.org/sys/table`
        }).catch((err) => {
            assert.deepEqual(err.status, 403);
        });
    });

    it('should set a request ID for each sub-request and return it', () => {
        const slice = server.config.logStream.slice();
        return preq.get({
            uri: `${server.config.labsBucketURL}/html/Foobar`,
            headers: {
                'Cache-Control': 'no-cache'
            }
        })
        .delay(1000)
        .then((res) => {
            slice.halt();
            const reqId = res.headers['x-request-id'];
            assert.notDeepEqual(reqId, undefined, 'Request ID not returned');
            slice.get().forEach((line) => {
                const a = JSON.parse(line);
                if (a.req || a.request_id) {
                    assert.deepEqual(a.request_id, reqId, 'Request ID mismatch');
                }
            });
        });
    });

    it('should honour the provided request ID', () => {
        const reqId = 'b6c17ea83d634b31bb28d60aae1caaac';
        const slice = server.config.logStream.slice();
        return preq.get({
            uri: `${server.config.labsBucketURL}/html/Foobar`,
            headers: {
                'X-Request-Id': reqId
            }
        }).then((res) => {
            slice.halt();
            assert.deepEqual(res.headers['x-request-id'], reqId, 'Returned request ID does not match the sent one');
            slice.get().forEach((line) => {
                const a = JSON.parse(line);
                if (a.req || a.request_id) {
                    assert.deepEqual(a.request_id, reqId, 'Request ID mismatch');
                }
            });
        });
    });

    it('should log the request ID for a 404', () => {
        const reqId = '9c54ff673d634b31bb28d60aae1cb43c';
        const slice = server.config.logStream.slice();
        return preq.get({
            uri: `${server.config.labsBucketURL}/foo-bucket/Foobar`,
            headers: {
                'X-Request-Id': reqId
            }
        }).then((res) => {
            slice.halt();
            throw new Error(`Expected a 404, got ${res.status}`);
        }, (err) => {
            slice.halt();
            assert.deepEqual(err.headers['x-request-id'], reqId, 'Returned request ID does not match the sent one');
            slice.get().forEach((line) => {
                const a = JSON.parse(line);
                if (a.req || a.request_id) {
                    assert.deepEqual(a.request_id, reqId, 'Request ID mismatch');
                }
            });
        });
    });

    it('should truncate body upon HEAD request', () => {
        return preq.head({
            uri: `${server.config.labsBucketURL}/html/Foobar`
        })
        .then((res) => {
            assert.deepEqual(res.status, 200);
            assert.deepEqual(res.headers['content-length'], undefined);
            assert.deepEqual(res.body, '');
        });
    });
});
