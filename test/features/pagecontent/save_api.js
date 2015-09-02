'use strict';


var assert = require('../../utils/assert.js');
var preq   = require('preq');
var server = require('../../utils/server.js');


describe('page save api', function() {

    var uri = server.config.labsURL + '/wikitext/Main_Page';
    var htmlUri = server.config.labsURL + '/html/Save_test';
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

    this.timeout(20000);

    before(function () {
        return server.start().then(function() {
            return preq.get({
                uri: 'http://en.wikipedia.beta.wmflabs.org/w/api.php',
                query: {
                    action: 'query',
                    meta: 'tokens',
                    format: 'json',
                    formatversion: 2
                }
            });
        })
        .then(function(res) {
            token = res.body.query.tokens.csrftoken;
            return preq.get({
                uri: server.config.labsURL + '/revision/' + oldRev
            });
        })
        .then(function(res) {
            oldETag = res.headers.etag;
        })
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
        return preq.post({
            uri: uri,
            body: {
                wikitext: 'abcd',
                token: 'this_is_a_bad_token'
            }
        }).then(function(res) {
            throw new Error('Expected an error, but got status: ' + res.status);
        }, function(err) {
            assert.deepEqual(err.status, 400);
            assert.deepEqual(err.body.title, 'badtoken');
        });
    });

    it('fail for bad baseETag', function() {
        return preq.post({
            uri: uri,
            body: {
                baseETag: 'this_is_a_bad_ETag',
                wikitext: 'abcd',
                token: 'this_is_a_bad_token'
            }
        }).then(function(res) {
            throw new Error('Expected an error, but got status: ' + res.status);
        }, function(err) {
            assert.deepEqual(err.status, 400);
            assert.deepEqual(err.body.title, 'Bad baseETag');
        });
    });

    it('fails for bad baseETag timestamp', function() {
        return preq.post({
            uri: uri,
            body: {
                baseETag: oldETag + 'this_should_not_be_here',
                wikitext: 'abcd',
                token: 'this_is_a_bad_token'
            }
        }).then(function(res) {
            throw new Error('Expected an error, but got status: ' + res.status);
        }, function(err) {
            assert.deepEqual(err.status, 400);
            assert.deepEqual(err.body.title, 'Bad baseETag');
        });
    });

    it('fail for bad if-match etag', function() {
        return preq.post({
            uri: uri,
            body: {
                wikitext: 'abcd',
                token: 'this_is_a_bad_token'
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
                token: 'this_is_a_bad_token'
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
            uri: uri,
            body: {
                wikitext: 'abcd',
                token: 'this_is_a_bad_token'
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
            uri: uri,
            body: {
                baseETag: '12sd121s/test_test',
                wikitext: 'abcd',
                token: 'this_is_a_bad_token'
            }
        }).then(function(res) {
            throw new Error('Expected an error, but got status: ' + res.status);
        }, function(err) {
            assert.deepEqual(err.status, 400);
            assert.deepEqual(err.body.title, 'Bad revision');
        });
    });

    it('save page', function() {
        return preq.post({
            uri: uri,
            body: {
                wikitext: saveText,
                token: token
            },
            headers: {
                'if-match': lastETag
            }
        })
        .then(function(res) {
            assert.deepEqual(res.status, 201);
            lastRev = res.body.newrevid;
            return preq.get({
                uri: server.config.labsURL + '/revision/' + lastRev
            });
        })
        .then(function(res) {
            lastETag = res.headers.etag;
        });
    });

    it('no change', function() {
        return preq.post({
            uri: uri,
            body: {
                wikitext: saveText,
                token: token
            },
            headers: {
                'if-match': lastETag
            }
        }).then(function(res) {
            assert.deepEqual(res.status, 200);
            assert.deepEqual(res.body.nochange, true);
        });
    });

    it('detect conflict', function() {
        return preq.post({
            uri: uri,
            body: {
                baseETag: oldETag,
                wikitext: saveText + "\n\nExtra text",
                token: token
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
    });

    it('save HTML', function() {
        return preq.get({
            uri: htmlUri + '/' + lastRev
        }).then(function(res) {
            assert.deepEqual(res.status, 200, 'Could not retrieve test page!');
            return preq.post({
                uri: htmlUri,
                body: {
                    html: res.body.replace(/\<\/body\>/, '<p>Generated via direct HTML save!</p></body>'),
                    token: token
                },
                headers: {
                    'if-match': lastETag
                }
            });
        }).then(function(res) {
            assert.deepEqual(res.status, 201);
        });
    });

    it('detect conflict on save HTML', function() {
        return preq.get({
            uri: htmlUri + '/' + oldRev
        }).then(function(res) {
            assert.deepEqual(res.status, 200, 'Could not retrieve test page!');
            return preq.post({
                uri: htmlUri,
                body: {
                    html: res.body.replace(/\<\/body\>/, '<p>Old revision edit that should detect conflict!</p></body>'),
                    token: token,
                    baseETag: oldETag
                },
                headers: {
                    'if-match': lastETag
                }
            });
        }).then(function(res) {
            throw new Error('Expected an error, but got status: ' + res.status);
        }, function(err) {
            assert.deepEqual(err.status, 409);
            assert.deepEqual(err.body.title, 'editconflict');
        });
    });
});

