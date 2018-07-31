'use strict';

const assert = require('../utils/assert.js');
const server = require('../utils/server.js');
const preq   = require('preq');

describe('Page Content Service: /page/media', () => {
    before(() => server.start());

    const pageTitle = 'Foobar';
    const pageRev = 757550077;

    it('Should fetch latest media', () => {
        return preq.get({
            uri: `${server.config.bucketURL}/media/${pageTitle}`
        })
        .then((res) => {
            assert.deepEqual(res.status, 200);
            assert.deepEqual(/^application\/json/.test(res.headers['content-type']), true);
            assert.deepEqual(!!res.headers.etag, true);
            assert.deepEqual(!!res.body.items, true);
        });
    });

    it('Should fetch older media', () => {
        return preq.get({
            uri: `${server.config.bucketURL}/media/${pageTitle}/${pageRev}`
        })
        .then((res) => {
            assert.deepEqual(res.status, 200);
            assert.deepEqual(/^application\/json/.test(res.headers['content-type']), true);
            assert.deepEqual(new RegExp(`^"${pageRev}\/.+"$`).test(res.headers.etag), true);
            assert.deepEqual(!!res.body.items, true);
        });
    });
});

