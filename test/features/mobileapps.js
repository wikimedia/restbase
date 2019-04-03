'use strict';

const assert = require('../utils/assert.js');
const Server = require('../utils/server.js');
const preq   = require('preq');

describe('Mobile Content Service', () => {
    const server = new Server();
    before(() => server.start());
    after(() => server.stop());

    const pageTitle = 'Foobar';
    const pageRev = 757550077;

    it('Should fetch latest mobile-sections', () => {
        return preq.get({
            uri: `${server.config.bucketURL()}/mobile-sections/${pageTitle}`
        })
        .then((res) => {
            assert.deepEqual(res.status, 200);
            assert.deepEqual(/^application\/json/.test(res.headers['content-type']), true);
            assert.deepEqual(!!res.headers.etag, true);
            assert.deepEqual(!!res.body.lead, true);
            assert.deepEqual(!!res.body.remaining, true);
        });
    });

    it('Should fetch latest mobile-sections-lead', () => {
        return preq.get({
            uri: `${server.config.bucketURL()}/mobile-sections-lead/${pageTitle}`
        })
        .then((res) => {
            assert.deepEqual(res.status, 200);
            assert.deepEqual(/^application\/json/.test(res.headers['content-type']), true);
            assert.deepEqual(!!res.headers.etag, true);
        });
    });

    it('Should fetch latest mobile-sections-remaining', () => {
        return preq.get({
            uri: `${server.config.bucketURL()}/mobile-sections-remaining/${pageTitle}`
        })
        .then((res) => {
            assert.deepEqual(res.status, 200);
            assert.deepEqual(/^application\/json/.test(res.headers['content-type']), true);
            assert.deepEqual(!!res.headers.etag, true);
        });
    });

    it('Should fetch older mobile-sections', () => {
        return preq.get({
            uri: `${server.config.bucketURL()}/mobile-sections/${pageTitle}/${pageRev}`
        })
        .then((res) => {
            assert.deepEqual(res.status, 200);
            assert.deepEqual(/^application\/json/.test(res.headers['content-type']), true);
            assert.deepEqual(new RegExp(`^"${pageRev}\/.+"$`).test(res.headers.etag), true);
            assert.deepEqual(!!res.body.lead, true);
            assert.deepEqual(!!res.body.remaining, true);
            assert.deepEqual(res.body.lead.revision, pageRev);
        });
    });

    it('Should fetch older mobile-sections-lead', () => {
        return preq.get({
            uri: `${server.config.bucketURL()}/mobile-sections-lead/${pageTitle}/${pageRev}`
        })
        .then((res) => {
            assert.deepEqual(res.status, 200);
            assert.deepEqual(/^application\/json/.test(res.headers['content-type']), true);
            assert.deepEqual(new RegExp(`^"${pageRev}\/.+"$`).test(res.headers.etag), true);
            assert.deepEqual(res.body.revision, pageRev);
        });
    });

    it('Should fetch older mobile-sections-remaining', () => {
        return preq.get({
            uri: `${server.config.bucketURL()}/mobile-sections-remaining/${pageTitle}/${pageRev}`
        })
        .then((res) => {
            assert.deepEqual(res.status, 200);
            assert.deepEqual(/^application\/json/.test(res.headers['content-type']), true);
            assert.deepEqual(new RegExp(`^"${pageRev}\/.+"$`).test(res.headers.etag), true);
        });
    });
});

