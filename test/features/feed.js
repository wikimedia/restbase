'use strict';

const assert = require('../utils/assert.js');
const server = require('../utils/server.js');
const preq   = require('preq');

function assertStorageRequest(requests, method, bucket, expected) {
    const storageRequests = requests.filter(log =>
        log.req && log.req.uri === `/en.wikipedia.org/sys/table/${bucket}/`
            && log.req.method === method);
    if (expected) {
        assert.deepEqual(storageRequests.length > 0, true,
            `Should have made ${method} request to ${bucket}`);
    } else {
        assert.deepEqual(storageRequests.length === 0, true,
            `Should NOT have made ${method} request to ${bucket}`);
    }
}

function assertMCSRequest(requests, content, date, expected) {
    let serviceURI = `https://appservice.wmflabs.org/en.wikipedia.org/v1/${content}`;
    if (date) {
        serviceURI += `/${date}`;
    }
    const serviceRequests = requests.filter(log =>
        log.req && log.req.uri === serviceURI);
    if (expected) {
        assert.deepEqual(serviceRequests.length > 0, true,
            `Should have made request to service for ${content}`);
    } else {
        assert.deepEqual(serviceRequests.length === 0, true,
            `Should NOT have made request to service for ${content}`);
    }
}


describe('Featured feed', () => {

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
            assertStorageRequest(requests, 'get', 'feed.aggregated', false);
            assertStorageRequest(requests, 'put', 'feed.aggregated', false);
            assertMCSRequest(requests, 'page/featured', date, true);
            assertMCSRequest(requests, 'page/most-read', date, true);
            assertMCSRequest(requests, 'media/image/featured', date, true);
            assertMCSRequest(requests, 'page/news', undefined, false);
        });
    });

    it.skip('Should not rerender available historic content', () => {
        const date = '2016/10/01';
        const slice = server.config.logStream.slice();
        return preq.get({
            uri: `${server.config.baseURL}/feed/featured/2016/10/01`
        })
        .delay(1000)
        .then(() => {
            slice.halt();
            const requests = slice.get().map(JSON.parse);
            assertStorageRequest(requests, 'get', 'feed.aggregated', false);
            assertStorageRequest(requests, 'put', 'feed.aggregated', false);
            assertMCSRequest(requests, 'page/featured', date, false);
            assertMCSRequest(requests, 'page/most-read', date, false);
            assertMCSRequest(requests, 'media/image/featured', date, false);
            assertMCSRequest(requests, 'page/news', undefined, false);
        });
    });

    it.skip('Should partially rerender available historic content, no-cache', () => {
        const date = '2016/10/01';
        const slice = server.config.logStream.slice();
        return preq.get({
            uri: `${server.config.baseURL}/feed/featured/2016/10/01`,
            headers: {
                'cache-control': 'no-cache'
            }
        })
        .delay(1000)
        .then(() => {
            slice.halt();
            const requests = slice.get().map(JSON.parse);
            assertStorageRequest(requests, 'get', 'feed.aggregated', false);
            assertStorageRequest(requests, 'put', 'feed.aggregated', false);
            assertMCSRequest(requests, 'page/featured', date, true);
            assertMCSRequest(requests, 'page/most-read', date, true);
            assertMCSRequest(requests, 'media/image/featured', date, true);
            assertMCSRequest(requests, 'page/news', undefined, false);
        });
    });

    it('Should render non-available current content', () => {
        const now = new Date();
        const date = now.toISOString().split('T').shift().split('-').join('/');
        const slice = server.config.logStream.slice();
        return preq.get({
            uri: `${server.config.baseURL}/feed/featured/${date}`
        })
        .delay(1000)
        .then(() => {
            slice.halt();
            const requests = slice.get().map(JSON.parse);
            assertStorageRequest(requests, 'put', 'feed.aggregated', false);
            assertMCSRequest(requests, 'page/featured', date, true);
            assertMCSRequest(requests, 'page/most-read', date, true);
            assertMCSRequest(requests, 'media/image/featured', date, true);
            assertMCSRequest(requests, 'page/news', undefined, true);
        });
    });

    it('Should rerender available current content', () => {
        const now = new Date();
        const date = now.toISOString().split('T').shift().split('-').join('/');
        const slice = server.config.logStream.slice();
        return preq.get({
            uri: `${server.config.baseURL}/feed/featured/${date}`
        })
        .delay(1000)
        .then(() => {
            slice.halt();
            const requests = slice.get().map(JSON.parse);
            assertMCSRequest(requests, 'page/featured', date, true);
            assertMCSRequest(requests, 'page/most-read', date, true);
            assertMCSRequest(requests, 'media/image/featured', date, true);
            assertMCSRequest(requests, 'page/news', undefined, true);
        });
    });

    it('Should rerender available current content with no-cache', () => {
        const now = new Date();
        const date = now.toISOString().split('T').shift().split('-').join('/');
        const slice = server.config.logStream.slice();
        return preq.get({
            uri: `${server.config.baseURL}/feed/featured/${date}`,
            headers: {
                'cache-control': 'no-cache'
            }
        })
        .delay(1000)
        .then(() => {
            slice.halt();
            const requests = slice.get().map(JSON.parse);
            assertStorageRequest(requests, 'put', 'feed.aggregated', false);
            assertMCSRequest(requests, 'page/featured', date, true);
            assertMCSRequest(requests, 'page/most-read', date, true);
            assertMCSRequest(requests, 'media/image/featured', date, true);
            assertMCSRequest(requests, 'page/news', undefined, true);
        });
    });

    it('Should not allow invalid yyyy param', () => {
        return preq.get({
            uri: `${server.config.baseURL}/feed/featured/0000/01/01`,
            headers: {
                'cache-control': 'no-cache'
            }
        })
        .then(() => {
            throw new Error('Must have failed');
        }, (e) => {
            assert.deepEqual(e.status, 400);
        });
    });

    it('Should not allow invalid mm param', () => {
        return preq.get({
            uri: `${server.config.baseURL}/feed/featured/2016/1/01`,
            headers: {
                'cache-control': 'no-cache'
            }
        })
        .then(() => {
            throw new Error('Must have failed');
        }, (e) => {
            assert.deepEqual(e.status, 400);
        });
    });

    it('Should not allow invalid dd param', () => {
        return preq.get({
            uri: `${server.config.baseURL}/feed/featured/2016/01/1`,
            headers: {
                'cache-control': 'no-cache'
            }
        })
        .then(() => {
            throw new Error('Must have failed');
        }, (e) => {
            assert.deepEqual(e.status, 400);
        });
    });

});

