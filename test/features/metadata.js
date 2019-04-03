'use strict';

const assert = require('../utils/assert.js');
const Server = require('../utils/server.js');
const preq   = require('preq');

describe('Page Content Service: /page/metadata', () => {
    const server = new Server();
    before(() => server.start());
    after(() => server.stop());

    const pageTitle = 'Foobar';
    const pageRev = 757550077;

    const commonChecks = (res) => {
        assert.deepEqual(res.status, 200);
        assert.deepEqual(/^application\/json/.test(res.headers['content-type']), true);
        assert.deepEqual(!!res.body.revision, true);
        assert.deepEqual(!!res.body.tid, true);
        assert.deepEqual(!!res.body.toc, true);
        assert.deepEqual(!!res.body.language_links, true);
        assert.deepEqual(!!res.body.categories, true);
        assert.deepEqual(!!res.body.protection, true);
    };

    it('Should fetch latest metadata', () => {
        return preq.get({
            uri: `${server.config.bucketURL()}/metadata/${pageTitle}`
        })
        .then((res) => {
            commonChecks(res);
            assert.deepEqual(!!res.headers.etag, true);
        });
    });

    it('Should fetch older metadata', () => {
        return preq.get({
            uri: `${server.config.bucketURL()}/metadata/${pageTitle}/${pageRev}`
        })
        .then((res) => {
            commonChecks(res);
            assert.deepEqual(new RegExp(`^"${pageRev}\/.+"$`).test(res.headers.etag), true);
        });
    });
});

