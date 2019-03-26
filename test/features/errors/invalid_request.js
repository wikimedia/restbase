'use strict';

const parallel = require('mocha.parallel');
const assert  = require('../../utils/assert.js');
const preq    = require('preq');
const Server  = require('../../utils/server.js');
const nock    = require('nock');

parallel('400 handling', function() {
    this.timeout(20000);
    const server = new Server();
    let siteInfo;
    let revisionInfo;
    before(() => {
        if (!nock.isActive()) {
            nock.activate();
        }
        return server.start()
        .then(() => {
            // Fetch real siteInfo to return from a mock
            return preq.post({
                uri: server.config.apiURL('en.wikipedia.beta.wmflabs.org'),
                body: {
                    action: 'query',
                    meta: 'siteinfo|filerepoinfo',
                    siprop: 'general|namespaces|namespacealiases',
                    format: 'json',
                    formatversion: 2
                }
            });
        })
        .then((res) => {
            siteInfo = res.body;
            // Fetch real revision info for Main_Page
            return preq.post({
                uri: server.config.apiURL('en.wikipedia.beta.wmflabs.org'),
                body: {
                    action: 'query',
                    prop: 'info|revisions',
                    continue: '',
                    rvprop: 'ids|timestamp|user|userid|size|sha1|comment|tags',
                    format: 'json',
                    formatversion: 2,
                    titles: 'Main_Page'
                }
            });
        })
        .then((res) => {
            revisionInfo = res.body;
        });
    });
    after(() => server.stop());

    it('should refetch siteInfo on error', () => {
        // Set up nock:
        // 1. Throw an error on siteInfo fetch
        // 2. Return correct siteInfo
        // 3. Return revision data
        const mwApi = nock(server.config.apiURL('en.wikipedia.beta.wmflabs.org'), { allowUnmocked: true })
        .post('').reply(400)
        .post('').reply(200, siteInfo)
        .post('').reply(200, revisionInfo);

        return preq.get({
            uri: `${server.config.bucketURL('en.wikipedia.beta.wmflabs.org')}/title/Main_Page`
        })
        .catch((e) => {
            assert.deepEqual(e.status, 500);
            return preq.get({
                uri: `${server.config.bucketURL('en.wikipedia.beta.wmflabs.org')}/title/Main_Page`
            });
        })
        .then((res) => {
            assert.deepEqual(res.status, 200);
            assert.deepEqual(res.body.items[0].title, 'Main_Page');
            mwApi.done();
        })
        .finally(() => { nock.cleanAll(); });
    });

    it('should return a proper 400 for an empty POST', () => {
        return preq.post({
            uri: server.config.hostPort,
            headers: {
                'content-type': 'foo/bar'
            },
        })
        .catch((e) => {
            assert.deepEqual(e.status, 400);
            assert.contentType(e, 'application/problem+json');
        });
    });

    it('should return a proper 400 for an invalid POST', () => {
        return preq.post({
            uri: server.config.hostPort,
            headers: {
                'content-type': 'foo/bar'
            },
            body: 'baz'
        })
        .catch((e) => {
            assert.deepEqual(e.status, 400);
            assert.contentType(e, 'application/problem+json');
        });
    });
});
