'use strict';

const assert = require('../../utils/assert.js');
const preq   = require('preq');
const server = require('../../utils/server.js');
const P      = require('bluebird');
const nock   = require('nock');

const NOCK_TESTS = true;

describe('page save api', function() {

    const pageTitle = 'Save_test';
    const wikitextUri = `${server.config.labsBucketURL}/wikitext/${pageTitle}`;
    const htmlUri = `${server.config.labsBucketURL}/html/${pageTitle}`;
    let token = '';
    let oldETag = '';
    const saveText = `${"Welcome to the page which tests the [[:mw:RESTBase|RESTBase]] save " +
        "API! This page is created by an automated test to make sure RESTBase works " +
        "with the current version of MediaWiki.\n\n" +
        "== Date ==\nText generated on "}${new Date().toUTCString()}\n\n` +
        `== Random ==\nHere's a random number: ${Math.floor(Math.random() * 32768)}`;
    const oldRev = 259419;
    let lastRev = 0;
    let lastETag = '';
    const labsApiURL = server.config.labsApiURL;

    this.timeout(20000);

    before(() => {
        if (!nock.isActive()) {
            nock.activate();
        }
        return server.start().then(() => {
            return P.all([
                preq.get({
                    uri: server.config.labsApiURL,
                    query: {
                        action: 'query',
                        meta: 'tokens',
                        format: 'json',
                        formatversion: 2
                    }
                })
                .then((res) => {
                    token = res.body.query.tokens.csrftoken;
                }),

                preq.get({
                    uri: `${server.config.labsBucketURL}/title/${pageTitle}/${oldRev}`
                })
                .then((res) => {
                    oldETag = res.headers.etag;
                })
            ]);
        })
        .then(() => {
            // Do a preparation request to force siteinfo fetch so that we don't need to mock it
            return preq.get({
                uri: `${server.config.labsBucketURL}/html/Main_Page`
            });
        });
    });

    it('fail for missing content', () => {
        return preq.post({
            uri: wikitextUri,
            body: {
                wikitext: '',
                csrf_token: token
            }
        }).then((res) => {
            throw new Error(`Expected an error, but got status: ${res.status}`);
        }, (err) => {
            assert.deepEqual(err.status, 400);
            assert.deepEqual(err.body.title, 'Missing parameters');
        });
    });

    it('fail for missing token', () => {
        return preq.post({
            uri: wikitextUri,
            body: {
                wikitext: 'abcd'
            }
        }).then((res) => {
            throw new Error(`Expected an error, but got status: ${res.status}`);
        }, (err) => {
            assert.deepEqual(err.status, 400);
            assert.deepEqual(err.body.detail, "data.body should have required property 'csrf_token'");
        });
    });

    it('fail for bad token', () => {
        const test = () => {
            return preq.post({
                uri: wikitextUri,
                body: {
                    wikitext: 'abcd',
                    csrf_token: 'this_is_a_bad_token'
                }
            }).then((res) => {
                throw new Error(`Expected an error, but got status: ${res.status}`);
            }, (err) => {
                assert.deepEqual(err.status, 400);
                assert.deepEqual(err.body.title, 'badtoken');
            });
        };

        if (NOCK_TESTS) {
            const api = nock(labsApiURL)
                // Mock MW API badtoken response
            .post('')
            .reply(200, {
                "servedby": "nock",
                "error": {
                    "code": "badtoken",
                    "info": "Invalid token"
                }
            });

            return test()
            .then(() => { api.done(); })
            .finally(() => { nock.cleanAll(); });
        } else {
            return test();
        }
    });

    it('fail for bad base_etag', () => {
        return preq.post({
            uri: wikitextUri,
            body: {
                base_etag: 'this_is_a_bad_ETag',
                wikitext: 'abcd',
                csrf_token: 'this_is_a_bad_token'
            }
        }).then((res) => {
            throw new Error(`Expected an error, but got status: ${res.status}`);
        }, (err) => {
            assert.deepEqual(err.status, 400);
            assert.deepEqual(err.body.title, 'Bad base_etag');
        });
    });

    it('fails for bad base_etag timestamp', () => {
        return preq.post({
            uri: wikitextUri,
            body: {
                base_etag: `${oldETag}this_should_not_be_here`,
                wikitext: 'abcd',
                csrf_token: 'this_is_a_bad_token'
            }
        }).then((res) => {
            throw new Error(`Expected an error, but got status: ${res.status}`);
        }, (err) => {
            assert.deepEqual(err.status, 400);
            assert.deepEqual(err.body.title, 'Bad base_etag');
        });
    });

    it('fail for bad if-match etag', () => {
        return preq.post({
            uri: wikitextUri,
            body: {
                wikitext: 'abcd',
                csrf_token: 'this_is_a_bad_token'
            },
            headers: {
                'if-match': 'this_is_a_bad_ETag'
            }
        }).then((res) => {
            throw new Error(`Expected an error, but got status: ${res.status}`);
        }, (err) => {
            assert.deepEqual(err.status, 400);
            assert.deepEqual(err.body.title, 'Bad ETag in If-Match');
        });
    });

    it('fail for bad if-match etag timestamp', () => {
        return preq.post({
            uri: wikitextUri,
            body: {
                wikitext: 'abcd',
                csrf_token: 'this_is_a_bad_token'
            },
            headers: {
                'if-match': `${lastETag}this_should_not_be_here`
            }
        }).then((res) => {
            throw new Error(`Expected an error, but got status: ${res.status}`);
        }, (err) => {
            assert.deepEqual(err.status, 400);
            assert.deepEqual(err.body.title, 'Bad ETag in If-Match');
        });
    });

    it('fail for bad if-match etag revision', () => {
        return preq.post({
            uri: wikitextUri,
            body: {
                wikitext: 'abcd',
                csrf_token: 'this_is_a_bad_token'
            },
            headers: {
                'if-match': `this_should_not_be_here${lastETag}`
            }
        }).then((res) => {
            throw new Error(`Expected an error, but got status: ${res.status}`);
        }, (err) => {
            assert.deepEqual(err.status, 400);
            assert.deepEqual(err.body.title, 'Bad ETag in If-Match');
        });
    });

    it('fail for bad revision', () => {
        return preq.post({
            uri: wikitextUri,
            body: {
                base_etag: '12sd121s/test_test',
                wikitext: 'abcd',
                csrf_token: 'this_is_a_bad_token'
            }
        }).then((res) => {
            throw new Error(`Expected an error, but got status: ${res.status}`);
        }, (err) => {
            assert.deepEqual(err.status, 400);
            assert.deepEqual(err.body.title, 'Bad revision');
        });
    });

    it('save page', () => {
        const test = () => {
            return preq.post({
                uri: wikitextUri,
                body: {
                    wikitext: saveText,
                    csrf_token: token
                }
            })
            .then((res) => {
                assert.deepEqual(res.status, 201);
                lastRev = res.body.newrevid;
                return preq.get({
                    uri: `${server.config.labsBucketURL}/title/${pageTitle}/${lastRev}`
                });
            })
            .then((res) => {
                lastETag = res.headers.etag;
            });
        }

        if (NOCK_TESTS) {
            const now = new Date().toISOString();
            const api = nock(labsApiURL)
            .post('')
            .reply(200, {
                edit: {
                    result: "Success",
                    pageid: 127114,
                    title: "Save test",
                    oldrevid: 275830,
                    newrevid: 275831,
                    newtimestamp: now
                }
            })
            .post('')
            .reply(200, {
                'batchcomplete': '',
                'query': {
                    'pages': {
                        '127114': {
                            'pageid': 127114,
                            'ns': 0,
                            'title': 'Save test',
                            'pagelanguage': 'en',
                            'touched': now,
                            'lastrevid': 275831,
                            'length': 2941,
                            'revisions': [{
                                'revid': 275831,
                                'user': 'Chuck Norris',
                                'userid': 3606755,
                                'timestamp': now,
                                'size': 2941,
                                'sha1': 'c47571122e00f28402d2a1b75cff77a22e7bfecd',
                                'comment': 'Test',
                                'tags': []
                            }]
                        }
                    }
                }
            });
            return test()
            .then(() => { api.done(); })
            .finally(() => { nock.cleanAll(); });
        } else {
            return test();
        }
    });

    it('no change', () => {
        const test = () => {
            return preq.post({
                uri: wikitextUri,
                body: {
                    wikitext: saveText,
                    csrf_token: token
                },
                headers: {
                    'if-match': lastETag
                }
            })
            .then((res) => {
                assert.deepEqual(res.status, 200);
                assert.deepEqual(res.body.nochange, true);
            });
        };

        if (NOCK_TESTS) {
            const api = nock(labsApiURL)
            // Mock MW API nochange response
            .post('')
            .reply(200, {
                edit: {
                    result: "Success",
                    pageid: 127114,
                    title: "Save test",
                    nochange: true
                }
            });

            return test()
            .then(() => { api.done(); })
            .finally(() => { nock.cleanAll(); });
        } else {
            return test();
        }
    });

    it('detect conflict', () => {
        const test = () => {
            return preq.post({
                uri: wikitextUri,
                body: {
                    base_etag: oldETag,
                    wikitext: `${saveText}\n\nExtra text`,
                    csrf_token: token
                },
                headers: {
                    'if-match': lastETag
                }
            }).then((res) => {
                throw new Error(`Expected an error, but got status: ${res.status}`);
            }, (err) => {
                assert.deepEqual(err.status, 409);
                assert.deepEqual(err.body.title, 'editconflict');
            });
        };

        if (NOCK_TESTS) {
            const api = nock(labsApiURL)
                // Mock MW API editconflict response
            .post('')
            .reply(200, {
                "servedby": "nock",
                "error": {
                    "code": "editconflict",
                    "info": "Edit conflict detected"
                }
            });

            return test()
            .then(() => { api.done(); })
            .finally(() => { nock.cleanAll(); });
        } else {
            return test();
        }
    });

    it('save HTML', () => {
        const test = () => {
            return preq.get({
                uri: `${htmlUri}/${lastRev}`
            }).then((res) => {
                assert.deepEqual(res.status, 200, 'Could not retrieve test page!');
                return preq.post({
                    uri: htmlUri,
                    headers: {
                        'x-client-ip': '123.123.123.123',
                        cookie: 'test'
                    },
                    body: {
                        html: res.body.replace(/\<\/body\>/,
                        `<p>Generated via direct HTML save! Random ${Math.floor(Math.random() * 32768)} </p></body>`),
                        csrf_token: token
                    }
                });
            }).then((res) => {
                assert.deepEqual(res.status, 201);
                lastETag = res.headers.etag;
            });
        };

        if (NOCK_TESTS) {
            const api = nock(labsApiURL, {
                reqheaders: {
                    'x-client-ip': '123.123.123.123',
                    'x-forwarded-for'(headerValue) {
                        return headerValue.indexOf('127.0.0.1') >= 0;
                    },
                    cookie: 'test'
                }
            })
            .post('')
            .reply(200, {
                edit: {
                    result: "Success",
                    pageid: 46950417,
                    title: "Save_Test",
                    oldrevid: 680525605,
                    newrevid: 680525800,
                    newtimestamp: new Date().toISOString()
                }
            });

            return test()
            .then(() => { api.done(); })
            .finally(() => { nock.cleanAll(); });
        } else {
            return test();
        }
    });

    /*
     // The summary endpoint gets rerendered on this test. As it's done asyncronously, without waiting
     // for a rerender to happen, there's no way to predict an order of the API calls, se we
     // cannot set up NOCK for this test. When we switch to controlling rerenders with a change propagation
     // system, this test should be uncommented back.
     //
     // TODO: uncomment when explicit `summary` invalidation from parsoid is replaced by change propagation
    it('detect conflict on save HTML', () => {
        const test = () => {
            return preq.get({
                uri: htmlUri + '/' + lastRev
            })
            .then((res) => {
                assert.deepEqual(res.status, 200, 'Could not retrieve test page!');
                return preq.post({
                    uri: htmlUri,
                    headers: {
                        'if-match': lastETag
                    },
                    body: {
                        html: res.body.replace(/\<\/body\>/, '<p>Old revision edit that should detect conflict!</p></body>'),
                        csrf_token: token,
                        base_etag: oldETag
                    }
                });
            }).then((res) => {
                throw new Error('Expected an error, but got status: ' + res.status);
            }, (err) => {
                assert.deepEqual(err.status, 409);
                assert.deepEqual(err.body.title, 'editconflict');
            });
        }

        if (NOCK_TESTS) {
            const api = nock(labsApiURL)
            .post('')
            .reply(200, {
                "servedby": "nock",
                "error": {
                    "code": "editconflict",
                    "info": "Edit conflict detected"
                }
            });
            return test()
            .then(() => { api.done(); })
            .finally(() => { nock.cleanAll(); });
        } else {
            return test();
        }
    });
    */
});
