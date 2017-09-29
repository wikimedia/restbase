/* eslint-disable max-len */

'use strict';

// mocha defines to avoid JSHint breakage
/* global describe, it, before */

const assert = require('../../utils/assert.js');
const preq   = require('preq');
const server = require('../../utils/server.js');
const nock   = require('nock');
const P      = require('bluebird');

describe('Access checks', () => {

    const deletedPageTitle = 'User:Pchelolo/Access_Check_Tests';
    const deletedPageOlderRevision = 705347919;
    const deletedPageRevision = 705347950;
    const emptyResponse = { 'batchcomplete': '', 'query': { 'badrevids': { '292466': { 'revid': '292466' } } } };

    function setUpNockResponse(api, title, revision) {
        return api.post('')
        .reply(200, {
            'batchcomplete': '',
            'query': {
                'pages': {
                    '49453581': {
                        'pageid': 49453581,
                        'ns': 0,
                        title,
                        'contentmodel': 'wikitext',
                        'pagelanguage': 'en',
                        'touched': '2015-05-22T08:49:39Z',
                        'lastrevid': revision,
                        'length': 2941,
                        'revisions': [{
                            'revid': revision,
                            'user': 'Chuck Norris',
                            'userid': 3606755,
                            'timestamp': '2015-03-25T20:29:50Z',
                            'size': 2941,
                            'sha1': 'c47571122e00f28402d2a1b75cff77a22e7bfecd',
                            'contentmodel': 'wikitext',
                            'comment': 'Test',
                            'tags': []
                        }]
                    }
                }
            }
        });
    }

    before(() => {
        return server.start()
        // Do a preparation request to force siteinfo fetch so that we don't need to mock it
        .then(() => P.join(
            preq.get({ uri: `${server.config.bucketURL}/html/Main_Page` }),
            preq.get({ uri: `${server.config.labsBucketURL}/html/Main_Page` })
        ))
        // Load in the revisions
        .then(() => {
            let api = nock(server.config.apiURL);
            api = setUpNockResponse(api, deletedPageTitle, deletedPageOlderRevision);
            api = setUpNockResponse(api, deletedPageTitle, deletedPageRevision);
            return preq.get({
                uri: `${server.config.bucketURL}/html/${encodeURIComponent(deletedPageTitle)}/${deletedPageOlderRevision}`
            })
            .then((res) => {
                assert.deepEqual(res.status, 200);
                return preq.get({
                    uri: `${server.config.bucketURL}/html/${encodeURIComponent(deletedPageTitle)}/${deletedPageRevision}`
                });
            })
            .then(res => assert.deepEqual(res.status, 200))
            .then(res => api.done())
            .finally(() => nock.cleanAll());
        });
    });

    describe('Deleting', () => {
        it('should understand the page was deleted', () => {
            const api = nock(server.config.apiURL)
            // Other requests return nothing as if the page is deleted.
            .post('').reply(200, emptyResponse);
            // Fetch the page
            return preq.get({
                uri: `${server.config.bucketURL}/title/${encodeURIComponent(deletedPageTitle)}`,
                headers: {
                    'cache-control': 'no-cache'
                }
            })
            .then(() => {
                throw new Error('404 should have been returned for a deleted page');
            }, (e) => {
                assert.deepEqual(e.status, 404);
                assert.contentType(e, 'application/problem+json');
            })
            .then(() => {
                api.done();
            })
            .finally(() => {
                nock.cleanAll();
            });
        });
    });

    function testAccess(contentVariant, restrictionType, title, rev) {
        let name = `should restrict access to ${restrictionType} page `;
        name += rev ? 'older revision' : 'latest';
        name += ` ${contentVariant}`;
        it(name, () => {
            // Check that access is enforced to html
            let uri = `${server.config.bucketURL}/${contentVariant}/${encodeURIComponent(title)}`;
            if (rev) {
                uri += `/${rev}`;
            }
            return preq.get({ uri })
            .then((res) => {
                throw new Error('404 should have been returned for a deleted page');
            }, (e) => {
                assert.deepEqual(e.status, 404);
                assert.contentType(e, 'application/problem+json');
            });
        });
    }

    describe('Checking deletions', () => {
        it('should restrict access to deleted page latest revision', () => {
            // This is only required until the hack for no-cache header is in place
            const api = nock(server.config.apiURL)
            .post('').reply(200, emptyResponse);

            return preq.get({
                uri: `${server.config.bucketURL}/title/${encodeURIComponent(deletedPageTitle)}/${deletedPageRevision}`
            })
            .then(() => {
                throw new Error('404 should have been returned for a deleted page');
            }, (e) => {
                assert.deepEqual(e.status, 404);
                assert.contentType(e, 'application/problem+json');
            })
            .then(() => {
                api.done();
            })
            .finally(() => {
                nock.cleanAll();
            });
        });

        it('should restrict access to older revision of a deleted page', () => {
            // This is only required until the hack for no-cache header is in place
            const api = nock(server.config.apiURL)
            .post('').reply(200, emptyResponse);

            return preq.get({
                uri: `${server.config.bucketURL}/title/${encodeURIComponent(deletedPageTitle)}/${deletedPageOlderRevision}`
            })
            .then(() => {
                throw new Error('404 should have been returned for a deleted page');
            }, (e) => {
                assert.deepEqual(e.status, 404);
                assert.contentType(e, 'application/problem+json');
            })
            .then(() => {
                api.done();
            })
            .finally(() => {
                nock.cleanAll();
            });
        });

        testAccess('html', 'deleted', deletedPageTitle);
        testAccess('data-parsoid', 'deleted', deletedPageTitle);
        testAccess('html', 'deleted', deletedPageTitle, deletedPageOlderRevision);
        testAccess('data-parsoid', 'deleted', deletedPageTitle, deletedPageOlderRevision);
        testAccess('mobile-sections', 'deleted', deletedPageTitle);
        testAccess('mobile-sections-lead', 'deleted', deletedPageTitle);
        testAccess('mobile-sections-remaining', 'deleted', deletedPageTitle);
        testAccess('summary', 'deleted', deletedPageTitle);
    });

    describe('Undeleting', () => {
        it('Should understand that the page was undeleted', () => {
            return preq.get({
                uri: `${server.config.bucketURL}/title/${encodeURIComponent(deletedPageTitle)}`,
                headers: {
                    'cache-control': 'no-cache'
                }
            })
            .then((res) => {
                assert.deepEqual(res.status, 200);
                return preq.get({
                    uri: `${server.config.bucketURL}/html/${encodeURIComponent(deletedPageTitle)}/${deletedPageOlderRevision}`,
                });
            })
            .then((res) => {
                assert.deepEqual(res.status, 200);
            });
        });
    });

    describe('Restricting', () => {
        const pageTitle = 'User:Pchelolo/restriction_testing_mock';
        const pageRev = 301375;
        it('should correctly fetch updated restrictions', () => {
            const normalRev = {
                "revid": pageRev,
                "user": "Pchelolo",
                "userid": 6591,
                "timestamp": "2015-02-03T21:15:55Z",
                "size": 7700,
                "contentmodel": "wikitext",
                "tags": []
            };
            const normalResponse = {
                "pageid": 152993,
                "ns": 3,
                "title": pageTitle,
                "contentmodel": "wikitext",
                "pagelanguage": "en",
                "pagelanguagehtmlcode": "en",
                "pagelanguagedir": "ltr",
                "touched": "2015-12-10T23:41:54Z",
                "lastrevid": pageRev,
                "length": 23950,
                "revisions": [normalRev]
            };
            const restrictedRev = Object.assign({}, normalRev);
            restrictedRev.texthidden = true;
            restrictedRev.sha1hidden = true;
            const restrictedResponse = Object.assign({}, normalResponse);
            restrictedResponse.revisions = [restrictedRev];
            const api = nock(server.config.labsApiURL)
            .post('').reply(200, {
                "batchcomplete": "",
                "query": { "pages": { "45161196": normalResponse } }
            }).post('').reply(200, {
                "batchcomplete": "",
                "query": { "pages": { "45161196": restrictedResponse } }
            });

            // First fetch a non-restricted revision
            return preq.get({
                uri: `${server.config.labsBucketURL}/title/${encodeURIComponent(pageTitle)}`
            })
            .then((res) => {
                assert.deepEqual(res.status, 200);
                assert.deepEqual(res.body.items.length, 1);
                // Now fetch update with restrictions
                return preq.get({
                    uri: `${server.config.labsBucketURL}/title/${encodeURIComponent(pageTitle)}`,
                    headers: {
                        'cache-control': 'no-cache'
                    }
                });
            }).then(() => {
                throw new Error('403 should be thrown');
            }, (e) => {
                assert.deepEqual(e.status, 403);
            }).then(() => {
                api.done();
            })
            .finally(() => {
                nock.cleanAll();
            });
        });


        it('should store updated restrictions', () => {
            return preq.get({
                uri: `${server.config.labsBucketURL}/html/${encodeURIComponent(pageTitle)}`
            })
            .then(() => {
                throw new Error('403 should be thrown');
            }, (e) => {
                assert.deepEqual(e.status, 403);
            });
        });

        it('should restrict access to restricted revision html', () => {
            return preq.get({
                uri: `${server.config.labsBucketURL}/html/${encodeURIComponent(pageTitle)}/${pageRev}`
            })
            .then(() => {
                throw new Error('403 should have been returned for a deleted page');
            }, (e) => {
                assert.deepEqual(e.status, 403);
                assert.contentType(e, 'application/problem+json');
            });
        });

        it('should allow to view content if restrictions disappeared', () => {
            return preq.get({
                uri: `${server.config.labsBucketURL}/title/${encodeURIComponent(pageTitle)}`,
                headers: {
                    'cache-control': 'no-cache'
                }
            })
            .then((res) => {
                assert.deepEqual(res.status, 200);
                return preq.get({
                    uri: `${server.config.labsBucketURL}/html/${encodeURIComponent(pageTitle)}/${pageRev}`,
                });
            })
            .then((res) => {
                assert.deepEqual(res.status, 200);
            });
        });
    });
});
