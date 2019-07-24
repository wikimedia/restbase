'use strict';

const assert = require('../utils/assert.js');
const Server = require('../utils/server.js');
const preq   = require('preq');

[
    {
        endpoint: 'media',
        check: (res) => {
            assert.deepEqual(res.status, 200);
            assert.deepEqual(/^application\/json/.test(res.headers['content-type']), true);
            assert.deepEqual(!!res.body.items, true);
        }
    },
    {
        endpoint: 'media-list',
        check: (res) => {
            assert.deepEqual(res.status, 200);
            assert.deepEqual(/^application\/json/.test(res.headers['content-type']), true);
            assert.deepEqual(!!res.body.items, true);
        }
    },
    {
        endpoint: 'metadata',
        check: (res) => {
            assert.deepEqual(res.status, 200);
            assert.deepEqual(/^application\/json/.test(res.headers['content-type']), true);
            assert.deepEqual(!!res.body.revision, true);
            assert.deepEqual(!!res.body.tid, true);
            assert.deepEqual(!!res.body.toc, true);
            assert.deepEqual(!!res.body.language_links, true);
            assert.deepEqual(!!res.body.categories, true);
            assert.deepEqual(!!res.body.protection, true);
        }
    },
    {
        endpoint: 'references',
        check: (res) => {
            assert.deepEqual(res.status, 200);
            assert.deepEqual(/^application\/json/.test(res.headers['content-type']), true);
            assert.deepEqual(!!res.body.revision, true);
            assert.deepEqual(!!res.body.tid, true);
            assert.deepEqual(!!res.body.reference_lists, true);
            assert.deepEqual(!!res.body.references_by_id, true);
        }
    }
].forEach((testSpec) => {
    describe(`Page Content Service: /page/${testSpec.endpoint}`, () => {
        const server = new Server();
        before(() => server.start());
        after(() => server.stop());

        const pageTitle = 'Foobar';
        const pageRev = 757550077;

        it(`Should fetch latest ${testSpec.endpoint}`, () => {
            return preq.get({
                uri: `${server.config.bucketURL()}/${testSpec.endpoint}/${pageTitle}`
            })
            .then((res) => {
                testSpec.check(res);
                assert.deepEqual(!!res.headers.etag, true);
            });
        });

        it(`Should fetch older ${testSpec.endpoint}`, () => {
            return preq.get({
                uri: `${server.config.bucketURL()}/${testSpec.endpoint}/${pageTitle}/${pageRev}`
            })
            .then((res) => {
                testSpec.check(res);
                assert.deepEqual(new RegExp(`^(?:W\/)?"${pageRev}\/.+"$`).test(res.headers.etag), true);
            });
        });
    });
});

