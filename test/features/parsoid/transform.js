'use strict';

const assert = require('../../utils/assert.js');
const Server = require('../../utils/server.js');
const preq   = require('preq');
const parallel = require('mocha.parallel');

const testPage = {
    title: 'User:Pchelolo%2fRestbase_Test',
    revision: '275854',
    wikitext: '<div id=bar>Selser test'
    // html is fetched dynamically
};

describe('transform api', function() {
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

    it('wt2html', () => {
        return preq.post({
            uri: `${server.config.baseURL('en.wikipedia.beta.wmflabs.org')}/transform/wikitext/to/html/User:GWicke%2F_restbase_test`,
            body: {
                wikitext: '== Heading =='
            }
        })
        .then((res) => {
            assert.deepEqual(res.status, 200);
            assert.contentType(res, contentTypes.html);
            const pattern = /<h2.*>Heading<\/h2>/;
            if (!pattern.test(res.body)) {
                throw new Error(`Expected pattern in response: ${pattern
                }\nSaw: ${res.body}`);
            }
        });
    });

    it('wt2html with body_only', () => {
        return preq.post({
            uri: `${server.config.baseURL('en.wikipedia.beta.wmflabs.org')}/transform/wikitext/to/html/User:GWicke%2F_restbase_test`,
            body: {
                wikitext: '== Heading ==',
                body_only: true
            }
        })
        .then((res) => {
            assert.deepEqual(res.status, 200);
            assert.contentType(res, contentTypes.html);
            const pattern = /^<h2.*>Heading<\/h2>$/;
            if (!pattern.test(res.body)) {
                throw new Error(`Expected pattern in response: ${pattern
                }\nSaw: ${res.body}`);
            }
        });
    });


    it('wt2lint', () => {
        return preq.post({
            uri: `${server.config.baseURL('en.wikipedia.beta.wmflabs.org')}/transform/wikitext/to/lint`,
            body: {
                wikitext: '== Heading =='
            }
        }).then((res) => {
            assert.deepEqual(res.status, 200);
            assert.deepEqual(res.body, []);
        });
    });

    it('wt2lint with errors', () => {
        return preq.post({
            uri: `${server.config.baseURL('en.wikipedia.beta.wmflabs.org')}/transform/wikitext/to/lint`,
            body: {
                wikitext: '<div>No div ending'
            }
        }).then((res) => {
            assert.deepEqual(res.status, 200);
            assert.deepEqual(res.body.length, 1);
        });
    });

    it('html2wt, no-selser', () => {
        return preq.post({
            uri: `${server.config.baseURL('en.wikipedia.beta.wmflabs.org')}/transform/html/to/wikitext/User:GWicke%2F_restbase_test`,
            body: {
                html: '<body>The modified HTML</body>'
            }

        })
        .then((res) => {
            assert.deepEqual(res.status, 200);
            assert.deepEqual(res.body, 'The modified HTML');
            assert.contentType(res, contentTypes.wikitext);
        });
    });

    it('html2wt, selser', () => {
        return preq.post({
            uri: `${server.config.baseURL('en.wikipedia.beta.wmflabs.org')}/transform/html/to/wikitext/${testPage.title}/${testPage.revision}`,
            body: {
                html: testPage.html
            }
        })
        .then((res) => {
            assert.deepEqual(res.status, 200);
            assert.deepEqual(res.body, testPage.wikitext);
            assert.contentType(res, contentTypes.wikitext);
        });
    });

    it('html2wt with scrub_wikitext', () => {
        return preq.post({
            uri: `${server.config.baseURL('en.wikipedia.beta.wmflabs.org')}/transform/html/to/wikitext`,
            body: {
                html: '<h2></h2>',
                scrub_wikitext: 1
            }
        })
        .then((res) => {
            assert.deepEqual(res.status, 200);
            assert.deepEqual(res.body, '');
        });
    });

    it('supports reversed order of properties in TimeUuid meta', () => {
        const newHtml = testPage.html.replace(/<meta property="mw:TimeUuid" content="([^"]+)"\/?>/,
            '<meta content="$1" property="mw:TimeUuid" />');
        return preq.post({
            uri: `${server.config.baseURL('en.wikipedia.beta.wmflabs.org')}/transform/html/to/wikitext/${testPage.title}/${testPage.revision}`,
            body: {
                html: newHtml
            }
        })
        .then((res) => {
            assert.deepEqual(res.status, 200);
            const pattern = /Selser test/;
            if (!pattern.test(res.body)) {
                throw new Error(`Expected pattern in response: ${pattern
                }\nSaw: ${JSON.stringify(res, null, 2)}`);
            }
            assert.contentType(res, contentTypes.wikitext);
        });
    });

    it('supports stashing content', () => {
        return preq.post({
            uri: `${server.config.baseURL('en.wikipedia.beta.wmflabs.org')}/transform/wikitext/to/html/${testPage.title}/${testPage.revision}`,
            body: {
                wikitext: '== ABCDEF ==',
                stash: true
            }
        })
        .then((res) => {
            assert.deepEqual(res.status, 200);
            const etag = res.headers.etag;
            assert.deepEqual(/\/stash"$/.test(etag), true);
            return preq.post({
                uri: `${server.config.baseURL('en.wikipedia.beta.wmflabs.org')}/transform/html/to/wikitext/${testPage.title}/${testPage.revision}`,
                headers: {
                    'if-match': etag
                },
                body: {
                    html: res.body.replace('>ABCDEF<', '>FECDBA<')
                }
            });
        })
        .then((res) => {
            assert.deepEqual(res.status, 200);
            assert.deepEqual(res.body, '== FECDBA ==');
        });
    });

    it('substitutes 0 as revision if not provided for stashing', () => {
        return preq.post({
            uri: `${server.config.baseURL('en.wikipedia.beta.wmflabs.org')}/transform/wikitext/to/html/${testPage.title}`,
            body: {
                wikitext: '== ABCDEF ==',
                stash: true
            }
        })
        .then((res) => {
            assert.deepEqual(res.status, 200);
            const etag = res.headers.etag;
            assert.deepEqual(/^"0\/[^\/]+\/stash"$/.test(etag), true);
        });
    });

    it('does not allow stashing without title', () => {
        return preq.post({
            uri: `${server.config.baseURL('en.wikipedia.beta.wmflabs.org')}/transform/wikitext/to/html`,
            body: {
                wikitext: '== ABCDEF ==',
                stash: true
            }
        })
        .then(() => {
            throw new Error('Error should be thrown');
        }, (e) => {
            assert.deepEqual(e.status, 400);
        });
    });

    it('does not allow to transform html with no tid', () => {
        return preq.post({
            uri: `${server.config.baseURL('en.wikipedia.beta.wmflabs.org')}/transform/html/to/wikitext/${testPage.title}/${testPage.revision}`,
            body: {
                html: '<h1>A</h1>'
            }
        })
        .then(() => {
            throw new Error('Error should be thrown');
        }, (e) => {
            assert.deepEqual(e.status, 400);
        });
    });
});

