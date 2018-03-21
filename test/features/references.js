"use strict";

const assert = require('../utils/assert.js');
const server = require('../utils/server.js');
const preq   = require('preq');

describe('Page Content Service: /page/references', () => {
    before(() => server.start());

    const pageTitle = 'Foobar';
    const pageRev = 757550077;

    const commonChecks = (res) => {
        assert.deepEqual(res.status, 200);
        assert.deepEqual(/^application\/json/.test(res.headers['content-type']), true);
        assert.deepEqual(!!res.body.revision, true);
        assert.deepEqual(!!res.body.tid, true);
        assert.deepEqual(!!res.body.reference_lists, true);
        assert.deepEqual(!!res.body.references_by_id, true);
    };

    it('Should fetch latest references', () => {
        return preq.get({
            uri: `${server.config.bucketURL}/references/${pageTitle}`
        })
        .then((res) => {
            commonChecks(res);
            assert.deepEqual(!!res.headers.etag, true);
        });
    });

    it('Should fetch older references', () => {
        return preq.get({
            uri: `${server.config.bucketURL}/references/${pageTitle}/${pageRev}`
        })
        .then((res) => {
            commonChecks(res);
            assert.deepEqual(new RegExp(`^"${pageRev}\/.+"$`).test(res.headers.etag), true);
        });
    });
});

