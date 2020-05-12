'use strict';

const assert = require('../utils/assert.js');
const Server = require('../utils/server.js');
const preq   = require('preq');

describe('Featured feed', () => {
    const server = new Server();
    before(() => server.start());
    after(() => server.stop());

    function assertMCSRequest(content, date, expected) {
        const serviceURI = 'https://wikifeeds.wmflabs.org';
        let path = `/${server.config.defaultDomain}/v1/${content}`;
        if (date) {
            path += `/${date}`;
        }
        const serviceRequests = assert.findRequests(log =>
            log.scope.startsWith(serviceURI) && log.path.startsWith(path));
        if (expected) {
            assert.deepEqual(serviceRequests.length > 0, true,
                `Should have made request to service for ${content}`);
        } else {
            assert.deepEqual(serviceRequests.length === 0, true,
                `Should NOT have made request to service for ${content}`);
        }
    }

    it('Should render non-available historic content', () => {
        const date = '2016/10/01';
        assert.recordRequests();
        return preq.get({
            uri: `${server.config.baseURL()}/feed/featured/${date}`
        })
        .then(() => {
            assertMCSRequest('page/featured', date, true);
            assertMCSRequest('page/most-read', date, true);
            assertMCSRequest('media/image/featured', date, true);
            assertMCSRequest('page/news', undefined, false);
        })
        .finally(() => assert.cleanupRecorder());
    });

    it.skip('Should not rerender available historic content', () => {
        const date = '2016/10/01';
        assert.recordRequests();
        return preq.get({
            uri: `${server.config.baseURL()}/feed/featured/2016/10/01`
        })
        .then(() => {
            assertMCSRequest('page/featured', date, false);
            assertMCSRequest('page/most-read', date, false);
            assertMCSRequest('media/image/featured', date, false);
            assertMCSRequest('page/news', undefined, false);
        })
        .finally(() => assert.cleanupRecorder());
    });

    it.skip('Should partially rerender available historic content, no-cache', () => {
        const date = '2016/10/01';
        assert.recordRequests();
        return preq.get({
            uri: `${server.config.baseURL()}/feed/featured/2016/10/01`,
            headers: {
                'cache-control': 'no-cache'
            }
        })
        .then(() => {
            assertMCSRequest('page/featured', date, true);
            assertMCSRequest('page/most-read', date, true);
            assertMCSRequest('media/image/featured', date, true);
            assertMCSRequest('page/news', undefined, false);
        })
        .finally(() => assert.cleanupRecorder());
    });

    it('Should render non-available current content', () => {
        const now = new Date();
        const date = now.toISOString().split('T').shift().split('-').join('/');
        assert.recordRequests();
        return preq.get({
            uri: `${server.config.baseURL()}/feed/featured/${date}`
        })
        .then(() => {
            assertMCSRequest('page/featured', date, true);
            assertMCSRequest('page/most-read', date, true);
            assertMCSRequest('media/image/featured', date, true);
            assertMCSRequest('page/news', undefined, true);
        })
        .finally(() => assert.cleanupRecorder());
    });

    it('Should rerender available current content', () => {
        const now = new Date();
        const date = now.toISOString().split('T').shift().split('-').join('/');
        assert.recordRequests();
        return preq.get({
            uri: `${server.config.baseURL()}/feed/featured/${date}`
        })
        .then(() => {
            assertMCSRequest('page/featured', date, true);
            assertMCSRequest('page/most-read', date, true);
            assertMCSRequest('media/image/featured', date, true);
            assertMCSRequest('page/news', undefined, true);
        })
        .finally(() => assert.cleanupRecorder());
    });

    it('Should rerender available current content with no-cache', () => {
        const now = new Date();
        const date = now.toISOString().split('T').shift().split('-').join('/');
        assert.recordRequests();
        return preq.get({
            uri: `${server.config.baseURL()}/feed/featured/${date}`,
            headers: {
                'cache-control': 'no-cache'
            }
        })
        .then(() => {
            assertMCSRequest('page/featured', date, true);
            assertMCSRequest('page/most-read', date, true);
            assertMCSRequest('media/image/featured', date, true);
            assertMCSRequest('page/news', undefined, true);
        })
        .finally(() => assert.cleanupRecorder());
    });

    it('Should not allow invalid yyyy param', () => {
        return preq.get({
            uri: `${server.config.baseURL()}/feed/featured/0000/01/01`,
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
            uri: `${server.config.baseURL()}/feed/featured/2016/1/01`,
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
            uri: `${server.config.baseURL()}/feed/featured/2016/01/1`,
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

