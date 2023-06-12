'use strict';

const assert = require('../utils/assert.js');
const Server = require('../utils/server.js');
const preq   = require('preq');


describe('Page Content Service: /page/media-list', () => {
    const server = new Server();
    before(async () => {
        // Cleaning require cache because of side-effects
        // on the way modules are instantiated in hyperswitch
        try {
            delete require.cache[require.resolve('../../v1/pcs/stored_endpoint.js')]
        } catch {
            console.log("Couldn't delete cached module")
        }
        await server.start();
    });
    after(() => server.stop());

    const pageTitle = 'San_Francisco';
    const pageRev = 395889;

    it('Should fetch latest media-list', () => {
        return preq.get({
            uri: `${server.config.bucketURL()}/media-list/${pageTitle}`
        })
            .then((res) => {
                assert.deepEqual(res.status, 200);
                assert.deepEqual(/^application\/json/.test(res.headers['content-type']), true);
                assert.deepEqual(!!res.body.items, true);
                assert.deepEqual(!!res.headers.etag, true);
                assert.deepEqual(res.headers['cache-control'], 'test_mobileapps_cache_control');
            });
    });

    it('Should fetch latest media-list without storing it', () => {
        // de.wikipedia.beta.wmflabs.org is configured to not use storage while testing
        return preq.get({
            uri: `${server.config.bucketURL('de.wikipedia.beta.wmflabs.org')}/media-list/Erde`
        })
            .then((res) => {
                assert.deepEqual(res.status, 200);
                assert.deepEqual(/^application\/json/.test(res.headers['content-type']), true);
                assert.deepEqual(res.headers['x-restbase-sunset'] || null, 'true');
                assert.deepEqual(!!res.body.items, true);
                assert.deepEqual(!!res.headers.etag, true);
                assert.deepEqual(res.headers['cache-control'], 'test_mobileapps_cache_control');
            });
    });

    it('Should fetch older media-list', () => {
        return preq.get({
            uri: `${server.config.bucketURL()}/media-list/${pageTitle}/${pageRev}`
        })
            .then((res) => {
                assert.deepEqual(res.status, 200);
                assert.deepEqual(/^application\/json/.test(res.headers['content-type']), true);
                assert.deepEqual(!!res.body.items, true);
                assert.deepEqual(new RegExp(`^(?:W\/)?"${pageRev}\/.+"$`).test(res.headers.etag), true);
                assert.deepEqual(res.headers['cache-control'], 'test_mobileapps_cache_control');
            });
    });
});

describe('Page Content Service: /page/mobile-html', () => {
    const server = new Server();
    before(async () => {
        // Cleaning require cache because of side-effects
        // on the way modules are instantiated in hyperswitch
        try {
            delete require.cache[require.resolve('../../v1/pcs/stored_endpoint.js')]
        } catch {
            console.log("Couldn't delete cached module")
        }
        await server.start();
    });
    after(() => server.stop());

    it('Should fetch latest mobile-html', () => {
        const pageTitle = 'Earth';
        return preq.get({
            uri: `${server.config.bucketURL()}/mobile-html/${pageTitle}`
        })
            .then((res) => {
                assert.deepEqual(res.status, 200);
                assert.deepEqual(/^text\/html/.test(res.headers['content-type']), true);
                assert.deepEqual(res.headers['x-restbase-sunset'] || null, null);
                assert.deepEqual(res.headers['cache-control'], 'test_mobileapps_cache_control');
            });
    });

    it('Should fetch latest mobile-html directly from PCS', () => {
        // de.wikipedia.beta.wmflabs.org is configured to not use storage while testing
        const domain = 'de.wikipedia.beta.wmflabs.org'
        const pageTitle = 'Erde';
        return preq.get({
            uri: `${server.config.bucketURL(domain)}/mobile-html/${pageTitle}`
        })
            .then((res) => {
                assert.deepEqual(res.status, 200);
                assert.deepEqual(/^text\/html/.test(res.headers['content-type']), true);
                assert.deepEqual(res.headers['x-restbase-sunset'] || null, 'true');
                assert.deepEqual(res.headers['cache-control'], 'test_mobileapps_cache_control');
            });
    });
});

describe('Page Content Service: transforms', () => {
    const server = new Server();
    before(() => server.start());
    after(() => server.stop());

    it('should transform wikitext to mobile-html', () => {
        return preq.post({
            uri: `${server.config.baseURL()}/transform/wikitext/to/mobile-html/Main_Page`,
            headers: {
                'output-mode': 'contentAndReferences'
            },
            body: {
                wikitext: `== Heading ==
                hello world`
            }
        })
        .then((res) => {
            assert.deepEqual(res.status, 200);
            assert.deepEqual(res.headers['content-language'], 'en');
            assert.checkString(res.headers['cache-control'], /private/, 'Must not be cached');
            assert.checkString(res.body, /<h2 id="Heading" class="(:?[^"]+)">Heading<\/h2>/);
            assert.checkString(res.body, /pcs-edit-section-link-container/);
        })
    });

    it('should transform wikitext to mobile-html, propagating output flags', () => {
        return preq.post({
            uri: `${server.config.baseURL()}/transform/wikitext/to/mobile-html/Main_Page`,
            headers: {
                'output-mode': 'editPreview'
            },
            body: {
                wikitext: `== Heading ==
                hello world`
            }
        })
        .then((res) => {
            assert.deepEqual(res.status, 200);
            assert.deepEqual(res.headers['content-language'], 'en');
            assert.deepEqual(/pcs-edit-section-link-container/.test(res.body), false);
        })
    });

    it('should transform wikitext to mobile-html, titles with special characters', () => {
        return preq.post({
            uri: `${server.config.baseURL('en.wikipedia.beta.wmflabs.org')}/transform/wikitext/to/mobile-html/User%3AMateusbs17%2F%2Fdev%2Frandom`,
            body: {
                wikitext: `== Heading ==
                hello world`
            }
        })
        .then((res) => {
            assert.deepEqual(res.status, 200);
            assert.deepEqual(res.headers['content-language'], 'en');
            assert.checkString(res.headers['cache-control'], /private/, 'Must not be cached');
            assert.checkString(res.body, /<h2 id="Heading" class="(:?[^"]+)">Heading<\/h2>/);
        })
    });

    it('should transform wikitext to mobile-html, language variants, no variant', () => {
        return preq.post({
            uri: `${server.config.baseURL('sr.wikipedia.beta.wmflabs.org')}/transform/wikitext/to/mobile-html/RESTBase_Testing_Page`,
            body: { wikitext: 'Ово је тестна страница - 1\n\nOvo je testna stranica - 2' }
        })
        .then((res) => {
            assert.deepEqual(res.status, 200);
            assert.deepEqual(res.headers['content-language'], 'sr');
            assert.checkString(res.headers['cache-control'], /private/, 'Must not be cached');
            assert.checkString(res.body, /Ово је тестна страница - 1/, 'Must not convert cyrillic with no variant');
            assert.checkString(res.body, /Ovo je testna stranica - 2/, 'Must not convert latin with no variant');
        });
    });

    it('should transform wikitext to mobile-html, language variants, cyrillic variant', () => {
        return preq.post({
            uri: `${server.config.baseURL('sr.wikipedia.beta.wmflabs.org')}/transform/wikitext/to/mobile-html/RESTBase_Testing_Page`,
            headers: {
                'accept-language': 'sr-Cyrl'
            },
            body: { wikitext: 'Ово је тестна страница - 1\n\nOvo je testna stranica - 2' }
        })
        .then((res) => {
            assert.deepEqual(res.status, 200);
            assert.deepEqual(res.headers['content-language'], 'sr-Cyrl');
            assert.checkString(res.headers['cache-control'], /private/, 'Must not be cached');
            assert.checkString(res.body, /Ово је тестна страница - 1/, 'Must not convert cyrillic with cyrillic variant');
            assert.checkString(res.body, /Ово је тестна страница - 2/, 'Must convert latin with cyrillic variant');
        });
    });

    it('should transform wikitext to mobile-html, language variants, latin variant', () => {
        return preq.post({
            uri: `${server.config.baseURL('sr.wikipedia.beta.wmflabs.org')}/transform/wikitext/to/mobile-html/RESTBase_Testing_Page`,
            headers: {
                'accept-language': 'sr-Latn'
            },
            body: { wikitext: 'Ово је тестна страница - 1\n\nOvo je testna stranica - 2' }
        })
        .then((res) => {
            assert.deepEqual(res.status, 200);
            assert.deepEqual(res.headers['content-language'], 'sr-Latn');
            assert.checkString(res.headers['cache-control'], /private/, 'Must not be cached');
            assert.checkString(res.body, /Ovo je testna stranica - 1/, 'Must convert cyrillic with latin variant');
            assert.checkString(res.body, /Ovo je testna stranica - 2/, 'Must not convert latin with latin variant');
        });
    });
});

