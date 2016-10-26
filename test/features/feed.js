"use strict";

const assert = require('../utils/assert.js');
const server = require('../utils/server.js');
const preq   = require('preq');
const P = require('bluebird');

function assertStorageRequest(requests, method, bucket, expected) {
    const storageRequests = requests.filter((log) =>
        log.req && log.req.uri === `/en.wikipedia.org/sys/table/${bucket}/`
            && log.req.method === method);
    if (expected) {
        assert.deepEqual(storageRequests.length > 0, true, `Should have made ${method} request to ${bucket}`);
    } else {
        assert.deepEqual(storageRequests.length === 0, true, `Should NOT have made ${method} request to ${bucket}`)
    }
}

function assertMCSRequest(requests, content, date, expected) {
    let serviceURI = `http://appservice.wmflabs.org/en.wikipedia.org/v1/${content}`;
    if (date) {
        serviceURI += `/${date}`;
    }
    const storageRequests = requests.filter((log) =>
        log.req && log.req.uri === serviceURI);
    if (expected) {
        assert.deepEqual(storageRequests.length > 0, true, `Should have made request to service for ${content}`);
    } else {
        assert.deepEqual(storageRequests.length === 0, true, `Should NOT have made request to service for ${content}`);
    }
}



describe('Feed', () => {

    before(() => server.start());

    it('Should render non-available historic content', () => {
        const date = '2016/10/01';
        const slice = server.config.logStream.slice();
        return preq.get({
            uri: `${server.config.baseURL}/feed/featured/${date}`
        })
        .delay(1000)
        .then(() => {
            slice.halt();
            const requests = slice.get().map(JSON.parse);
            assertStorageRequest(requests, 'get', 'feed.aggregated.historic', true);
            assertStorageRequest(requests, 'put', 'feed.aggregated.historic', true);
            assertStorageRequest(requests, 'get', 'feed.aggregated', false);
            assertStorageRequest(requests, 'put', 'feed.aggregated', false);
            assertMCSRequest(requests, 'page/featured', date, true);
            assertMCSRequest(requests, 'page/most-read', date, true);
            assertMCSRequest(requests, 'media/image/featured', date, true);
            assertMCSRequest(requests, 'page/news', undefined, false);
        });
    });

    it('Should not rerender available historic content', () => {
        const date = '2016/10/01';
        const slice = server.config.logStream.slice();
        return preq.get({
            uri: `${server.config.baseURL}/feed/featured/2016/10/01`
        })
        .delay(1000)
        .then(() => {
            slice.halt();
            const requests = slice.get().map(JSON.parse);
            assertStorageRequest(requests, 'get', 'feed.aggregated.historic', true);
            assertStorageRequest(requests, 'put', 'feed.aggregated.historic', false);
            assertStorageRequest(requests, 'get', 'feed.aggregated', false);
            assertStorageRequest(requests, 'put', 'feed.aggregated', false);
            assertMCSRequest(requests, 'page/featured', date, false);
            assertMCSRequest(requests, 'page/most-read', date, false);
            assertMCSRequest(requests, 'media/image/featured', date, false);
            assertMCSRequest(requests, 'page/news', undefined, false);
        });
    });

    it('Should render non-available current content', () => {
        const now = new Date();
        const date = `${now.getUTCFullYear()}/${now.getUTCMonth() + 1}/${now.getUTCDate()}`;
        const slice = server.config.logStream.slice();
        return preq.get({
            uri: `${server.config.baseURL}/feed/featured/${date}`
        })
        .delay(1000)
        .then(() => {
            slice.halt();
            const requests = slice.get().map(JSON.parse);
            assertStorageRequest(requests, 'get', 'feed.aggregated', true);
            assertStorageRequest(requests, 'put', 'feed.aggregated', true);
            assertStorageRequest(requests, 'put', 'feed.aggregated.historic', true);
            assertMCSRequest(requests, 'page/featured', date, true);
            assertMCSRequest(requests, 'page/most-read', date, true);
            assertMCSRequest(requests, 'media/image/featured', date, true);
            assertMCSRequest(requests, 'page/news', undefined, true);
        });
    });

    it('Should not rerender available current content', () => {
        const now = new Date();
        const date = `${now.getUTCFullYear()}/${now.getUTCMonth() + 1}/${now.getUTCDate()}`;
        const slice = server.config.logStream.slice();
        return preq.get({
            uri: `${server.config.baseURL}/feed/featured/${date}`
        })
        .delay(1000)
        .then(() => {
            slice.halt();
            const requests = slice.get().map(JSON.parse);
            assertStorageRequest(requests, 'get', 'feed.aggregated', true);
            assertMCSRequest(requests, 'page/featured', date, false);
            assertMCSRequest(requests, 'page/most-read', date, false);
            assertMCSRequest(requests, 'media/image/featured', date, false);
            assertMCSRequest(requests, 'page/news', undefined, false);
        });
    });
});
