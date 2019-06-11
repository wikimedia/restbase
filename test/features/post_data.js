'use strict';

const assert = require('../utils/assert.js');
const Server = require('../utils/server.js');
const preq   = require('preq');

describe('post_data', function() {
    this.timeout(20000);
    const server = new Server();
    before(() => server.start());
    after(() => server.stop());

    let hash = '';

    it('should store post request by hash', () => {
        return preq.post({
            uri: `${server.config.baseURL('fake.wikipedia.org')}/post_data/`,
            body: {
                key: 'value'
            }
        })
        .then((res) => {
            hash = res.body;
            assert.deepEqual(res.status, 201);
            assert.deepEqual(hash, '228458095a9502070fc113d99504226a6ff90a9a');
            return preq.get({
                uri: `${server.config.baseURL('fake.wikipedia.org')}/post_data/${res.body}`
            });
        })
        .then((res) => {
            assert.deepEqual(res.status, 200);
            assert.deepEqual(res.body, { key: 'value' });
        });
    });

    it('should not explode on empty body', () => {
        return preq.post({
            uri: `${server.config.baseURL('fake.wikipedia.org')}/post_data/`
        })
        .then((res) => {
            assert.deepEqual(res.status, 201);
        });
    });

    it('should not store identical request', () => {
        return preq.post({
            uri: `${server.config.baseURL('fake.wikipedia.org')}/post_data/`,
            body: {
                key: 'value'
            }
        })
        .then((res) => {
            assert.deepEqual(res.status, 200);
            assert.deepEqual(res.body, hash);
        });
    });

    it('should allow read on remote request', () => {
        return preq.get({
            uri: `${server.config.baseURL('fake.wikipedia.org')}/post_data/${hash}`
        })
        .then((res) => {
            assert.deepEqual(res.status, 200);
            assert.deepEqual(res.body, { key: 'value' });
        });
    });

    it('should deny write on remote requests', () => {
        return preq.post({
            uri: `${server.config.baseURL('fake.wikipedia.org')}/post_data/`,
            headers: {
                'x-client-ip': '123.123.123.123'
            },
            body: {
                key: 'value2'
            }
        })
        .then(() => {
            throw new Error('Error should be thrown');
        }, (e) => {
            assert.deepEqual(e.status, 403);
        });
    });
});
