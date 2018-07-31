'use strict';

// mocha defines to avoid JSHint breakage
/* global it, before */

const assert = require('../../utils/assert.js');
const server = require('../../utils/server.js');
const preq   = require('preq');
const parallel = require('mocha.parallel');

const testPage = {
    title: 'User:Pchelolo%2fRestbase_Test',
    revision: '275854',
    wikitext: '<div id=bar>Selser test'
    // html is fetched dynamically
};

parallel('transform api', function() {
    this.timeout(20000);

    before(() => {
        return server.start()
        .then(() => {
            return preq.get({
                uri: `${server.config.labsBucketURL
                }/html/${testPage.title
                }/${testPage.revision}`
            });
        })
        .then((res) => {
            testPage.html = res.body;
        });
    });

    const contentTypes = server.config.conf.test.content_types;

    /**
     * I don't think these have ever really worked.
     * Blocked on https://phabricator.wikimedia.org/T114413 (provide html2html
     * end point in Parsoid).
    it('html2html', function () {
        return preq.post({
            uri: server.config.labsURL
                + '/transform/html/to/html/' + testPage.title
                + '/' + testPage.revision,
            body: {
                html: testPage.html
            }
        })
        .then(function (res) {
            assert.deepEqual(res.status, 200);
            var pattern = /<div id="bar">Selser test<\/div>/;
            if (!pattern.test(res.body)) {
                throw new Error('Expected pattern in response: ' + pattern
                        + '\nSaw: ' + JSON.stringify(res, null, 2));
            }
            assert.contentType(res, contentTypes.html);
        });
    });

    it('html2html with body_only', function () {
        return preq.post({
            uri: server.config.labsURL
                + '/transform/html/to/html/' + testPage.title
                + '/' + testPage.revision,
            body: {
                html: testPage.html,
                body_only: true
            }
        })
        .then(function (res) {
            assert.deepEqual(res.status, 200);
            var pattern = /^<div id="bar">Selser test<\/div>$/;
            if (!pattern.test(res.body)) {
                throw new Error('Expected pattern in response: ' + pattern
                        + '\nSaw: ' + JSON.stringify(res, null, 2));
            }
            assert.contentType(res, contentTypes.html);
        });
    });
    */

    it('wt2html', () => {
        return preq.post({
            uri: `${server.config.labsURL
            }/transform/wikitext/to/html/User:GWicke%2F_restbase_test`,
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
            uri: `${server.config.labsURL
            }/transform/wikitext/to/html/User:GWicke%2F_restbase_test`,
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
            uri: `${server.config.labsURL}/transform/wikitext/to/lint`,
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
            uri: `${server.config.labsURL}/transform/wikitext/to/lint`,
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
            uri: `${server.config.labsURL
            }/transform/html/to/wikitext/User:GWicke%2F_restbase_test`,
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
            uri: `${server.config.labsURL
            }/transform/html/to/wikitext/${testPage.title
            }/${testPage.revision}`,
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
            uri: `${server.config.labsURL}/transform/html/to/wikitext`,
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

    it('sections2wt, replace', () => {
        const pageWithSectionsTitle = 'User:Pchelolo%2Fsections_test';
        const pageWithSectionsRev = 275834;
        return preq.post({
            uri: `${server.config.labsURL
            }/transform/section-changes/to/wikitext/${
                pageWithSectionsTitle
            }/${pageWithSectionsRev}`,
            headers: {
                'content-type': 'application/json'
            },
            body: {
                changes: {
                    mwAQ: [],
                    mwAw: [{ html: "<h2>First Section replaced</h2>" }],
                    mwBA: [{ html: "<h2>Second Section replaced</h2>" }]
                }
            }
        })
        .then((res) => {
            assert.deepEqual(res.status, 200);
            assert.contentType(res, contentTypes.wikitext);
            assert.deepEqual(res.body, '== First Section replaced ==\n\n' +
                '== Second Section replaced ==\n');
        });
    });

    it('sections2wt, replace, form-data', () => {
        const pageWithSectionsTitle = 'User:Pchelolo%2Fsections_test';
        const pageWithSectionsRev = 275834;
        return preq.post({
            uri: `${server.config.labsURL
            }/transform/section-changes/to/wikitext/${
                pageWithSectionsTitle
            }/${pageWithSectionsRev}`,
            body: {
                changes: JSON.stringify({
                    mwAQ: [],
                    mwAw: [{ html: "<h2>First Section replaced</h2>" }],
                    mwBA: [{ html: "<h2>Second Section replaced</h2>" }]
                }),
                scrub_wikitext: 'true'
            }
        })
        .then((res) => {
            assert.deepEqual(res.status, 200);
            assert.contentType(res, contentTypes.wikitext);
            assert.deepEqual(res.body, '== First Section replaced ==\n\n' +
                '== Second Section replaced ==\n');
        });
    });

    it('sections2wt, replace, scrub_wikitext', () => {
        const pageWithSectionsTitle = 'User:Pchelolo%2Fsections_test';
        const pageWithSectionsRev = 275834;
        return preq.post({
            uri: `${server.config.labsURL
            }/transform/section-changes/to/wikitext/${
                pageWithSectionsTitle
            }/${pageWithSectionsRev}`,
            headers: {
                'content-type': 'application/json'
            },
            body: {
                changes: {
                    mwAQ: [],
                    mwAw: [{ html: "<h2></h2>" }],
                    mwBA: [{ html: "<h2>Second Section replaced</h2>" }]
                },
                scrub_wikitext: true
            }
        })
        .then((res) => {
            assert.deepEqual(res.status, 200);
            assert.contentType(res, contentTypes.wikitext);
            assert.deepEqual(res.body, '== Second Section replaced ==\n');
        });
    });

    it('sections2wt, append', () => {
        const pageWithSectionsTitle = 'User:Pchelolo%2Fsections_test';
        const pageWithSectionsRev = 275834;
        return preq.post({
            uri: `${server.config.labsURL
            }/transform/section-changes/to/wikitext/${
                pageWithSectionsTitle
            }/${pageWithSectionsRev}`,
            headers: {
                'content-type': 'application/json'
            },
            body: {
                changes: {
                    mwAQ: [],
                    mwAw: [{ id: 'mwAw' }, { html: '<h2>Appended Section</h2>' }],
                    mwBA: [{ html: '<h2>Prepended section</h2>' }, { id: 'mwBA' }]
                }
            }
        })
        .then((res) => {
            assert.deepEqual(res.status, 200);
            assert.contentType(res, contentTypes.wikitext);
            assert.deepEqual(res.body,
                '== First Section ==\n\n' +
                '== Appended Section ==\n\n' +
                '== Prepended section ==\n\n' +
                '== Second Section ==\n');
        });
    });

    it('sections2wt, move', () => {
        const pageWithSectionsTitle = 'User:Pchelolo%2Fsections_test';
        const pageWithSectionsRev = 275834;
        return preq.post({
            uri: `${server.config.labsURL
            }/transform/section-changes/to/wikitext/${
                pageWithSectionsTitle
            }/${pageWithSectionsRev}`,
            body: {
                changes: {
                    mwAQ: [],
                    mwAw: [{ id: 'mwBA' }, { id: 'mwAw' }],
                    mwBA: []
                }
            },
            headers: {
                'content-type': 'application/json'
            }
        })
        .then((res) => {
            assert.deepEqual(res.status, 200);
            assert.contentType(res, contentTypes.wikitext);
            assert.deepEqual(res.body,
                '== Second Section ==\n' +
                '== First Section ==\n');
        });
    });

    it('sections2wt, throws on invalid id', () => {
        const pageWithSectionsTitle = 'User:Pchelolo%2Fsections_test';
        const pageWithSectionsRev = 275834;
        return preq.post({
            uri: `${server.config.labsURL
            }/transform/section-changes/to/wikitext/${
                pageWithSectionsTitle
            }/${pageWithSectionsRev}`,
            body: {
                changes: {
                    mwAASDC: []
                }
            },
            headers: {
                'content-type': 'application/json'
            }
        })
        .then(() => {
            throw new Error('Error must be thrown');
        })
        .catch((e) => {
            assert.deepEqual(e.status, 400);
        });
    });

    it('sections2wt, throws on invalid replacement id', () => {
        const pageWithSectionsTitle = 'User:Pchelolo%2Fsections_test';
        const pageWithSectionsRev = 275834;
        return preq.post({
            uri: `${server.config.labsURL
            }/transform/section-changes/to/wikitext/${
                pageWithSectionsTitle
            }/${pageWithSectionsRev}`,
            body: {
                changes: {
                    mwAw:[ { id: 'mwAASDC' }, { id: 'mwAw' } ]
                }
            },
            headers: {
                'content-type': 'application/json'
            }
        })
        .then(() => {
            throw new Error('Error must be thrown');
        })
        .catch((e) => {
            assert.deepEqual(e.status, 400);
        });
    });

    it('supports reversed order of properties in TimeUuid meta', () => {
        const newHtml = testPage.html.replace(/<meta property="mw:TimeUuid" content="([^"]+)"\/?>/,
            '<meta content="cc8ba6b3-636c-11e5-b601-24b4f65ab671" property="mw:TimeUuid" />');
        return preq.post({
            uri: `${server.config.labsURL
            }/transform/html/to/wikitext/${testPage.title
            }/${testPage.revision}`,
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

    it('returns 409 if revision was restricted while edit happened', () => {
        const badPageName = 'User_talk:DivineAlpha%2fQ1_2015_discussions';
        const badRevNumber = 645504917;
        return preq.post({
            uri: `${server.config.baseURL
            }/transform/html/to/wikitext/${badPageName}/${badRevNumber}`,
            body: {
                html: '<html><head>' +
                    '<meta property="mw:TimeUuid" content="71966eaf-62cd-11e5-8a88-952fdaad0387"/>' +
                    '</head><body></body></html>'
            }
        })
        .then(() => {
            throw new Error('Error should be thrown');
        }, (e) => {
            assert.deepEqual(e.status, 409);
        });
    });

    it('supports stashing content', () => {
        return preq.post({
            uri: `${server.config.labsURL
            }/transform/wikitext/to/html/${testPage.title}/${testPage.revision}`,
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
                uri: `${server.config.labsURL
                }/transform/html/to/wikitext/${testPage.title}/${testPage.revision}`,
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
            uri: `${server.config.labsURL
            }/transform/wikitext/to/html/${testPage.title}`,
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
            uri: `${server.config.labsURL
            }/transform/wikitext/to/html`,
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
            uri: `${server.config.labsURL}/transform/html/to/wikitext/${
                testPage.title}/${testPage.revision}`,
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


/* TODO: actually implement wikitext fetching
describe('storage-backed transform api', () => {
    this.timeout(20000);

    before(() => { return server.start(); });

    it('should load a specific title/revision from storage to send as the "original"', () => {
        return preq.post({
            uri: server.config.baseURL + '/transform/html/to/wikitext/Main_Page/1',
            headers: { 'content-type': 'application/json' },
            body: {
                headers: {
                  'content-type': 'text/html; charset=utf-8; profile="https://www.mediawiki.org/wiki/Specs/HTML/1.6.0"'
                },
                body: '<html>The modified HTML</html>'
            }
        })
        .then(res => {
            assert.deepEqual(res.status, 200);
            assert.deepEqual(res.body, {
                wikitext: {
                    headers: {
                        'content-type': 'text/plain; charset=utf-8; profile="https://www.mediawiki.org/wiki/Specs/wikitext/1.0.0"'
                    },
                    body: 'The modified HTML'
                }
            });
        });
    });

});
*/
