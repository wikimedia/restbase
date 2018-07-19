"use strict";

const assert = require('../utils/assert.js');
const server = require('../utils/server.js');
const preq   = require('preq');

describe('Page Content Service: /page/mobile-html', () => {
    before(() => server.start());

    const pageTitle = 'Foobar';
    const pageRev = 757550077;

    const commonChecks = (res) => {
        assert.deepEqual(res.status, 200);
        assert.deepEqual(/^text\/html/.test(res.headers['content-type']), true);
        assert.ok(res.body.length > 0);
    };

    it('Should fetch latest mobile-html', () => {
        return preq.get({
            uri: `${server.config.bucketURL}/mobile-html/${pageTitle}`
        })
        .then((res) => {
            commonChecks(res);
            assert.deepEqual(!!res.headers.etag, true);
        });
    });

    it('Should fetch older mobile-html', () => {
        return preq.get({
            uri: `${server.config.bucketURL}/mobile-html/${pageTitle}/${pageRev}`
        })
        .then((res) => {
            commonChecks(res);
            assert.deepEqual(new RegExp(`^"${pageRev}\/.+"$`).test(res.headers.etag), true);
        });
    });
});

