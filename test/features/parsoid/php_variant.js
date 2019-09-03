'use strict';

const assert = require('../../utils/assert.js');
const Server = require('../../utils/server.js');
const preq   = require('preq');

const testPage = {
    title: 'User:Pchelolo%2fRestbase_Test',
    revision: '275854',
    wikitext: '<div id=bar>Selser test'
    // html is fetched dynamically
};

describe('php parsoid variant', function() {
    this.timeout(20000);
    let contentTypes;
    const server = new Server();
    before(() => {
        return server.start()
        .then(() => {
            contentTypes = server.config.conf.test.content_types;
            return preq.get({
                uri: `${server.config.bucketURL('en.wikipedia.beta.wmflabs.org')}/html/${testPage.title}/${testPage.revision}`
            });
        })
        .then((res) => {
            testPage.html = res.body;
        });
    });
    after(() => server.stop());

    it('wt2html default variant', () => {
        return preq.post({
            uri: `${server.config.baseURL('en.wikipedia.beta.wmflabs.org')}/transform/wikitext/to/html/${testPage.title}`,
            body: {
                wikitext: '== Heading =='
            }
        })
        .then((res) => {
            assert.deepEqual(res.status, 200);
            assert.contentType(res, contentTypes.html);
            assert.deepEqual(res.headers['x-parsoid-variant'], 'JS');
            const pattern = /<h2.*>Heading<\/h2>/;
            if (!pattern.test(res.body)) {
                throw new Error(`Expected pattern in response: ${pattern}\nSaw: ${res.body}`);
            }
        });
    });

    it('wt2html php variant', () => {
        return preq.post({
            uri: `${server.config.baseURL('en.wikipedia.beta.wmflabs.org')}/transform/wikitext/to/html/${testPage.title}`,
            body: {
                wikitext: '== Heading =='
            },
            headers: {
                'x-parsoid-variant': 'PHP'
            }
        })
        .then((res) => {
            assert.deepEqual(res.status, 200);
            assert.contentType(res, contentTypes.html);
            assert.deepEqual(res.headers['x-parsoid-variant'], 'PHP');
            const pattern = /<h2.*>Heading<\/h2>/;
            if (!pattern.test(res.body)) {
                throw new Error(`Expected pattern in response: ${pattern}\nSaw: ${res.body}`);
            }
        });
    });
});

