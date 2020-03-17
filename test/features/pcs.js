'use strict';

const assert = require('../utils/assert.js');
const Server = require('../utils/server.js');
const preq   = require('preq');


describe('Page Content Service: /page/media-list', () => {
    const server = new Server();
    before(() => server.start());
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
                'accept-language': 'sr-ec'
            },
            body: { wikitext: 'Ово је тестна страница - 1\n\nOvo je testna stranica - 2' }
        })
        .then((res) => {
            assert.deepEqual(res.status, 200);
            assert.deepEqual(res.headers['content-language'], 'sr-ec');
            assert.checkString(res.headers['cache-control'], /private/, 'Must not be cached');
            assert.checkString(res.body, /Ово је тестна страница - 1/, 'Must not convert cyrillic with cyrillic variant');
            assert.checkString(res.body, /Ово је тестна страница - 2/, 'Must convert latin with cyrillic variant');
        });
    });

    it('should transform wikitext to mobile-html, language variants, latin variant', () => {
        return preq.post({
            uri: `${server.config.baseURL('sr.wikipedia.beta.wmflabs.org')}/transform/wikitext/to/mobile-html/RESTBase_Testing_Page`,
            headers: {
                'accept-language': 'sr-el'
            },
            body: { wikitext: 'Ово је тестна страница - 1\n\nOvo je testna stranica - 2' }
        })
        .then((res) => {
            assert.deepEqual(res.status, 200);
            assert.deepEqual(res.headers['content-language'], 'sr-el');
            assert.checkString(res.headers['cache-control'], /private/, 'Must not be cached');
            assert.checkString(res.body, /Ovo je testna stranica - 1/, 'Must convert cyrillic with latin variant');
            assert.checkString(res.body, /Ovo je testna stranica - 2/, 'Must not convert latin with latin variant');
        });
    });
});

