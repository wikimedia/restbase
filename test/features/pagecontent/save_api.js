'use strict';


var assert = require('../../utils/assert.js');
var preq   = require('preq');
var server = require('../../utils/server.js');
var P      = require('bluebird');
var nock   = require('nock');


describe('page save api', function() {

    var htmlTitle = 'User:Mobrovac-WMF%2FRB_Save_Api_Test';
    var uri = server.config.labsURL + '/wikitext/Save_test';
    var htmlUri = server.config.bucketURL + '/html/' + htmlTitle;
    var wikitextToken = '';
    var htmlToken = '';
    var oldWikitextETag = '';
    var oldHTMLEtag = '';
    var saveText = "Welcome to the page which tests the [[:mw:RESTBase|RESTBase]] save " +
        "API! This page is created by an automated test to make sure RESTBase works " +
        "with the current version of MediaWiki.\n\n" +
        "== Date ==\nText generated on " + new Date().toUTCString() + "\n\n" +
        "== Random ==\nHere's a random number: " + Math.floor(Math.random() * 32768);
    var oldWikitextRev = 259419;
    var oldHTMLRev = 666464140;
    var lastWikitextRev = 0;
    var lastHTMLRev = 0;
    var lastWikitextETag = '';
    var lastHTMLETag = '';
    var apiUri = server.config
        .conf.templates['wmf-sys-1.0.0']
        .paths['/{module:action}']['x-modules'][0].options.apiRequest.uri;

    var labsApiURI = apiUri.replace('{domain}', 'en.wikipedia.beta.wmflabs.org');
    var prodApiURI = apiUri.replace('{domain}', 'en.wikipedia.org');

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
                    wikitextToken = res.body.query.tokens.csrftoken;
                }),
                preq.get({
                    uri: 'http://en.wikipedia.org/w/api.php',
                    query: {
                        action: 'query',
                        meta: 'tokens',
                        format: 'json',
                        formatversion: 2
                    }
                })
                .then(function(res) {
                    htmlToken = res.body.query.tokens.csrftoken;
                }),

                preq.get({
                    uri: server.config.labsURL + '/revision/' + oldWikitextRev
                })
                .then(function(res) {
                    oldWikitextETag = res.headers.etag;
                }),
                preq.get({
                    uri: server.config.bucketURL + '/revision/' + oldHTMLRev
                })
                .then(function(res) {
                    oldHTMLEtag = res.headers.etag;
                }),

                preq.get({
                    uri: server.config.bucketURL + '/title/' + htmlTitle
                })
                .then(function(res) {
                    lastHTMLRev = res.body.items[0].rev;
                })
            ]);
        });
    });

    it('fail for missing content', function() {
        return preq.post({
            uri: uri,
            body: {
                wikitext: ''
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
            uri: uri,
            body: {
                wikitext: 'abcd'
            }
        }).then(function(res) {
            throw new Error('Expected an error, but got status: ' + res.status);
        }, function(err) {
            assert.deepEqual(err.status, 400);
            assert.deepEqual(err.body.title, 'Missing parameters');
        });
    });

    it('fail for bad token', function() {
        nock.enableNetConnect();
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

        return preq.post({
            uri: uri,
            body: {
                wikitext: 'abcd',
                csrf_token: 'this_is_a_bad_token'
            }
        }).then(function(res) {
            throw new Error('Expected an error, but got status: ' + res.status);
        }, function(err) {
            assert.deepEqual(err.status, 400);
            assert.deepEqual(err.body.title, 'badtoken');
        })
        .then(function() {
            api.done();
        })
        .finally(function() {
            nock.cleanAll();
        });
    });

    it('fail for bad base_etag', function() {
        return preq.post({
            uri: uri,
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
            uri: uri,
            body: {
                base_etag: oldWikitextETag + 'this_should_not_be_here',
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
            uri: uri,
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
            uri: uri,
            body: {
                wikitext: 'abcd',
                csrf_token: 'this_is_a_bad_token'
            },
            headers: {
                'if-match': lastWikitextETag + 'this_should_not_be_here'
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
            uri: uri,
            body: {
                wikitext: 'abcd',
                csrf_token: 'this_is_a_bad_token'
            },
            headers: {
                'if-match': 'this_should_not_be_here' + lastWikitextETag
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
            uri: uri,
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
        // Leave 1 test unmocked for sanity check.
        return preq.post({
            uri: uri,
            body: {
                wikitext: saveText,
                csrf_token: wikitextToken
            }
        })
        .then(function(res) {
            assert.deepEqual(res.status, 201);
            lastWikitextRev = res.body.newrevid;
            return preq.get({
                uri: server.config.labsURL + '/revision/' + lastWikitextRev
            });
        })
        .then(function(res) {
            lastWikitextETag = res.headers.etag;
        });
    });

    it('no change', function() {
        nock.enableNetConnect();
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

        return preq.post({
            uri: uri,
            body: {
                wikitext: saveText,
                csrf_token: wikitextToken
            },
            headers: {
                'if-match': lastWikitextETag
            }
        })
        .then(function(res) {
            assert.deepEqual(res.status, 200);
            assert.deepEqual(res.body.nochange, true);
        })
        .then(function() {
            api.done();
        })
        .finally(function() {
            nock.cleanAll();
        });
    });

    it('detect conflict', function() {
        nock.enableNetConnect();
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

        return preq.post({
            uri: uri,
            body: {
                base_etag: oldWikitextETag,
                wikitext: saveText + "\n\nExtra text",
                csrf_token: wikitextToken
            },
            headers: {
                'if-match': lastWikitextETag
            }
        }).then(function(res) {
            throw new Error('Expected an error, but got status: ' + res.status);
        }, function(err) {
            assert.deepEqual(err.status, 409);
            assert.deepEqual(err.body.title, 'editconflict');
        })
        .then(function() {
            api.done();
        })
        .finally(function() {
            nock.cleanAll();
        });
    });

    it('save HTML', function() {
        nock.enableNetConnect();
        var api = nock(prodApiURI, {
            reqheaders: {
                'x-forwarded-for': '123.123.123.123'
            }
        })
        // Mock MW API success response
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

        return preq.get({
            uri: htmlUri + '/' + lastHTMLRev
        }).then(function(res) {
            assert.deepEqual(res.status, 200, 'Could not retrieve test page!');
            return preq.post({
                uri: htmlUri,
                headers: {
                    'x-forwarded-for': '123.123.123.123'
                },
                body: {
                    html: res.body.replace(/\<\/body\>/,
                        '<p>Generated via direct HTML save! Random ' + Math.floor(Math.random() * 32768) + ' </p></body>'),
                    csrf_token: htmlToken
                }
            });
        }).then(function(res) {
            assert.deepEqual(res.status, 201);
            lastHTMLETag = res.headers.etag;
        })
        .then(function() {
            api.done();
        })
        .finally(function() {
            nock.cleanAll();
        });
    });

    it('detect conflict on save HTML', function() {
        nock.enableNetConnect();
        var api = nock(prodApiURI)
        // Mock MW API editconflict response
        .post('')
        .reply(200, {
            "servedby": "nock",
            "error": {
                "code": "editconflict",
                "info": "Edit conflict detected"
            }
        });

        return preq.get({
            uri: htmlUri + '/' + lastHTMLRev
        })
        .then(function(res) {
            assert.deepEqual(res.status, 200, 'Could not retrieve test page!');
            return preq.post({
                uri: htmlUri,
                headers: {
                    'if-match': lastHTMLETag
                },
                body: {
                    html: res.body.replace(/\<\/body\>/, '<p>Old revision edit that should detect conflict!</p></body>'),
                    csrf_token: htmlToken,
                    base_etag: oldHTMLEtag
                }
            });
        }).then(function(res) {
            throw new Error('Expected an error, but got status: ' + res.status);
        }, function(err) {
            assert.deepEqual(err.status, 409);
            assert.deepEqual(err.body.title, 'editconflict');
        })
        .then(function() {
            api.done();
        })
        .finally(function() {
            nock.cleanAll();
        });
    });
});