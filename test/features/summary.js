'use strict';

const assert = require('../utils/assert.js');
const Server = require('../utils/server.js');
const preq   = require('preq');
const P      = require('bluebird');
const nock   = require('nock');

describe('Mobile Content Service', () => {
    const server = new Server();
    before(() => server.start());
    after(() => server.stop());

    let recentRev, flaggedRev

    const pageTitle = 'Cat';
    const pageRev = 68036; // Old revision of the page on en.wikipedia.beta.wmflabs.org

    it('Should fetch summary', () => {
        return preq.get({
            uri: `${server.config.bucketURL()}/summary/${pageTitle}`
        })
        .then((res) => {
            recentRev = res.body.revision;
            assert.deepEqual(res.status, 200);
            assert.deepEqual(/^application\/json/.test(res.headers['content-type']), true);
            assert.deepEqual(!!res.headers.etag, true);
        });
    });

    it('Should fetch summary with revision', () => {
        return preq.get({
            uri: `${server.config.bucketURL()}/summary/${pageTitle}/${pageRev}`
        })
        .then((res) => {
            flaggedRev = res.body.revision;
            assert.deepEqual(res.status, 200);
            assert.deepEqual(/^application\/json/.test(res.headers['content-type']), true);
            assert.deepEqual(!!res.headers.etag, true);
        });
    });
    
    it('Latest and flagged revisions from the responses should not match' , () => {
        assert.ok(recentRev !== flaggedRev)
    });
});
