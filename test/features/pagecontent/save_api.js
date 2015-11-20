'use strict';


var assert = require('../../utils/assert.js');
var preq   = require('preq');
var server = require('../../utils/server.js');
var P      = require('bluebird');
var nock   = require('nock');

var NOCK_TESTS = true;

describe('page save api', function() {

    var wikitextUri = server.config.labsBucketURL + '/wikitext/Save_test';
    var htmlUri = server.config.labsBucketURL + '/html/Save_test';
    var token = '';
    var oldETag = '';
    var saveText = "Welcome to the page which tests the [[:mw:RESTBase|RESTBase]] save " +
        "API! This page is created by an automated test to make sure RESTBase works " +
        "with the current version of MediaWiki.\n\n" +
        "== Date ==\nText generated on " + new Date().toUTCString() + "\n\n" +
        "== Random ==\nHere's a random number: " + Math.floor(Math.random() * 32768);
    var oldRev = 259419;
    var lastRev = 0;
    var lastETag = '';
    var apiUri = server.config
        .conf.templates['wmf-sys-1.0.0']
        .paths['/{module:action}']['x-modules'][0].options.apiRequest.uri;
    var labsApiURI = apiUri.replace('{domain}', 'en.wikipedia.beta.wmflabs.org');

    this.timeout(20000);

    before(function () {
        return server.start().then(function() {
            return P.all([
                preq.get({
                    uri: 'http://en.wikipedia.beta.wmflabs.org/w/api.php',
                    query: {
                        action: 'query',
                        meta: 'tokens',
                        format: 'json',
                        formatversion: 2
                    }
                })
                .then(function(res) {
                    token = res.body.query.tokens.csrftoken;
                }),

                preq.get({
                    uri: server.config.labsBucketURL + '/revision/' + oldRev
                })
                .then(function(res) {
                    oldETag = res.headers.etag;
                })
            ]);
        });
    });

    it('fail for missing content', function() {
        return preq.post({
            uri: wikitextUri,
            body: {
                wikitext: '',
                csrf_token: token
            }
        }).then(function(res) {
            throw new Error('Expected an error, but got status: ' + res.status);
        }, function(err) {
            assert.deepEqual(err.status, 400);
            assert.deepEqual(err.body.title, 'Missing parameters');
        });
    });

    it('fail for missing token', function() {
        return preq.post({
            uri: wikitextUri,
            body: {
                wikitext: 'abcd'
            }
        }).then(function(res) {
            throw new Error('Expected an error, but got status: ' + res.status);
        }, function(err) {
            assert.deepEqual(err.status, 400);
            assert.deepEqual(err.body.detail, 'data.body.csrf_token is a required property');
        });
    });

    it('fail for bad token', function() {
        function test() {
            return preq.post({
                uri: wikitextUri,
                body: {
                    wikitext: 'abcd',
                    csrf_token: 'this_is_a_bad_token'
                }
            }).then(function(res) {
                throw new Error('Expected an error, but got status: ' + res.status);
            }, function(err) {
                assert.deepEqual(err.status, 400);
                assert.deepEqual(err.body.title, 'badtoken');
            });
        }

        if (NOCK_TESTS) {
            var api = nock(labsApiURI)
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
            .then(function() { api.done(); })
            .finally(function() { nock.cleanAll(); });
        } else {
            return test();
        }
    });

    it('fail for bad base_etag', function() {
        return preq.post({
            uri: wikitextUri,
            body: {
                base_etag: 'this_is_a_bad_ETag',
                wikitext: 'abcd',
                csrf_token: 'this_is_a_bad_token'
            }
        }).then(function(res) {
            throw new Error('Expected an error, but got status: ' + res.status);
        }, function(err) {
            assert.deepEqual(err.status, 400);
            assert.deepEqual(err.body.title, 'Bad base_etag');
        });
    });

    it('fails for bad base_etag timestamp', function() {
        return preq.post({
            uri: wikitextUri,
            body: {
                base_etag: oldETag + 'this_should_not_be_here',
                wikitext: 'abcd',
                csrf_token: 'this_is_a_bad_token'
            }
        }).then(function(res) {
            throw new Error('Expected an error, but got status: ' + res.status);
        }, function(err) {
            assert.deepEqual(err.status, 400);
            assert.deepEqual(err.body.title, 'Bad base_etag');
        });
    });

    it('fail for bad if-match etag', function() {
        return preq.post({
            uri: wikitextUri,
            body: {
                wikitext: 'abcd',
                csrf_token: 'this_is_a_bad_token'
            },
            headers: {
                'if-match': 'this_is_a_bad_ETag'
            }
        }).then(function(res) {
            throw new Error('Expected an error, but got status: ' + res.status);
        }, function(err) {
            assert.deepEqual(err.status, 400);
            assert.deepEqual(err.body.title, 'Bad ETag in If-Match');
        });
    });

    it('fail for bad if-match etag timestamp', function() {
        return preq.post({
            uri: wikitextUri,
            body: {
                wikitext: 'abcd',
                csrf_token: 'this_is_a_bad_token'
            },
            headers: {
                'if-match': lastETag + 'this_should_not_be_here'
            }
        }).then(function(res) {
            throw new Error('Expected an error, but got status: ' + res.status);
        }, function(err) {
            assert.deepEqual(err.status, 400);
            assert.deepEqual(err.body.title, 'Bad ETag in If-Match');
        });
    });

    it('fail for bad if-match etag revision', function() {
        return preq.post({
            uri: wikitextUri,
            body: {
                wikitext: 'abcd',
                csrf_token: 'this_is_a_bad_token'
            },
            headers: {
                'if-match': 'this_should_not_be_here' + lastETag
            }
        }).then(function(res) {
            throw new Error('Expected an error, but got status: ' + res.status);
        }, function(err) {
            assert.deepEqual(err.status, 400);
            assert.deepEqual(err.body.title, 'Bad ETag in If-Match');
        });
    });

    it('fail for bad revision', function() {
        return preq.post({
            uri: wikitextUri,
            body: {
                base_etag: '12sd121s/test_test',
                wikitext: 'abcd',
                csrf_token: 'this_is_a_bad_token'
            }
        }).then(function(res) {
            throw new Error('Expected an error, but got status: ' + res.status);
        }, function(err) {
            assert.deepEqual(err.status, 400);
            assert.deepEqual(err.body.title, 'Bad revision');
        });
    });

    it('save page', function() {
        function test() {
            return preq.post({
                uri: wikitextUri,
                body: {
                    wikitext: saveText,
                    csrf_token: token
                }
            })
            .then(function(res) {
                assert.deepEqual(res.status, 201);
                lastRev = res.body.newrevid;
                return preq.get({
                    uri: server.config.labsBucketURL + '/revision/' + lastRev
                });
            })
            .then(function(res) {
                lastETag = res.headers.etag;
            });
        }

        if (NOCK_TESTS) {
            var now = new Date().toISOString();
            var api = nock(labsApiURI)
            .post('')
            .reply(200, {
                edit: {
                    result: "Success",
                    pageid: 127114,
                    title: "Save test",
                    contentmodel: "wikitext",
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
                            'contentmodel': 'wikitext',
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
                                'contentmodel': 'wikitext',
                                'comment': 'Test',
                                'tags': []
                            }]
                        }
                    }
                }
            });
            return test()
            .then(function() { api.done(); })
            .finally(function() { nock.cleanAll(); });
        } else {
            return test();
        }
    });

    it('no change', function() {
        function test() {
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
            .then(function(res) {
                assert.deepEqual(res.status, 200);
                assert.deepEqual(res.body.nochange, true);
            });
        }

        if (NOCK_TESTS) {
            var api = nock(labsApiURI)
                // Mock MW API nochange response
            .post('')
            .reply(200, {
                edit: {
                    result: "Success",
                    pageid: 127114,
                    title: "Save test",
                    contentmodel: "wikitext",
                    nochange: true
                }
            });

            return test()
            .then(function() { api.done(); })
            .finally(function() { nock.cleanAll(); });
        } else {
            return test();
        }
    });

    it('detect conflict', function() {
        function test() {
            return preq.post({
                uri: wikitextUri,
                body: {
                    base_etag: oldETag,
                    wikitext: saveText + "\n\nExtra text",
                    csrf_token: token
                },
                headers: {
                    'if-match': lastETag
                }
            }).then(function(res) {
                throw new Error('Expected an error, but got status: ' + res.status);
            }, function(err) {
                assert.deepEqual(err.status, 409);
                assert.deepEqual(err.body.title, 'editconflict');
            });
        }

        if (NOCK_TESTS) {
            var api = nock(labsApiURI)
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
            .then(function() { api.done(); })
            .finally(function() { nock.cleanAll(); });
        } else {
            return test();
        }
    });

    it('save HTML', function() {
        function test() {
            return preq.get({
                uri: htmlUri + '/' + lastRev
            }).then(function(res) {
                assert.deepEqual(res.status, 200, 'Could not retrieve test page!');
                return preq.post({
                    uri: htmlUri,
                    headers: {
                        'x-client-ip': '123.123.123.123',
                        cookie: 'test'
                    },
                    body: {
                        html: res.body.replace(/\<\/body\>/,
                        '<p>Generated via direct HTML save! Random ' + Math.floor(Math.random() * 32768) + ' </p></body>'),
                        csrf_token: token
                    }
                });
            }).then(function(res) {
                assert.deepEqual(res.status, 201);
                lastETag = res.headers.etag;
            });
        }

        if (NOCK_TESTS) {
            var api = nock(labsApiURI, {
                reqheaders: {
                    'x-client-ip': '123.123.123.123',
                    'x-forwarded-for': '123.123.123.123',
                    cookie: 'test'
                }
            })
            .post('')
            .reply(200, {
                edit: {
                    result: "Success",
                    pageid: 46950417,
                    title: "User:Mobrovac-WMF/RB Save Api Test",
                    contentmodel: "wikitext",
                    oldrevid: 680525605,
                    newrevid: 680525800,
                    newtimestamp: new Date().toISOString()
                }
            });

            return test()
            .then(function() { api.done(); })
            .finally(function() { nock.cleanAll(); });
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

    it('detect conflict on save HTML', function() {
        function test() {
            return preq.get({
                uri: htmlUri + '/' + lastRev
            })
            .then(function(res) {
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
            }).then(function(res) {
                throw new Error('Expected an error, but got status: ' + res.status);
            }, function(err) {
                assert.deepEqual(err.status, 409);
                assert.deepEqual(err.body.title, 'editconflict');
            });
        }

        if (NOCK_TESTS) {
            var api = nock(labsApiURI)
            .post('')
            .reply(200, {
                "servedby": "nock",
                "error": {
                    "code": "editconflict",
                    "info": "Edit conflict detected"
                }
            });
            return test()
            .then(function() { api.done(); })
            .finally(function() { nock.cleanAll(); });
        } else {
            return test();
        }
    });
    */
});