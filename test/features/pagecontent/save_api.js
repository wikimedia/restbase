'use strict';


var assert = require('../../utils/assert.js');
var preq   = require('preq');
var server = require('../../utils/server.js');


describe('page save api', function() {

    var uri = server.config.bucketURL + '/wikitext/User:Mobrovac-WMF%2FRB_Save_Api_Test';
    var htmlUri = server.config.bucketURL + '/html/User:Mobrovac-WMF%2FRB_Save_Api_Test';
    var token = '';
    var saveText = "Welcome to the page which tests the [[:mw:RESTBase|RESTBase]] save" +
        "API! This page is created by an automated test to make sure RESTBase works " +
        "with the current version of MediaWiki.\n\n" +
        "== Date ==\nText generated on " + new Date().toUTCString() + "\n\n" +
        "== Random ==\nHere's a random number: " + Math.floor(Math.random() * 32768);
    var oldRev = 666464140;
    var lastRev = 0;

    this.timeout(20000);

    before(function () {
        return server.start().then(function() {
            return preq.get({
                uri: 'http://en.wikipedia.org/w/api.php',
                query: {
                    action: 'query',
                    meta: 'tokens',
                    format: 'json',
                    formatversion: 2
                }
            });
        }).then(function(res) {
            token = res.body.query.tokens.csrftoken;
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

    it('fail for bad revision', function() {
        return preq.post({
            uri: uri,
            body: {
                revision: '13r25fv31',
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
            }
        }).then(function(res) {
            assert.deepEqual(res.status, 201);
            lastRev = res.body.newrevid;
        });
    });

    it('no change', function() {
        return preq.post({
            uri: uri,
            body: {
                wikitext: saveText,
                token: token
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
                revision: oldRev,
                wikitext: saveText + "\n\nExtra text",
                token: token
            }
        }).then(function(res) {
            throw new Error('Expected an error, but got status: ' + res.status);
        }, function(err) {
            assert.deepEqual(err.status, 409);
            assert.deepEqual(err.body.title, 'editconflict');
        });
    });

    /*
     * TODO: Uncomment once POST /page/html/{title} is publicly available
    it('save HTML', function() {
        return preq.get({
            uri: htmlUri + '/' + lastRev
        }).then(function(res) {
            assert.deepEqual(res.status, 200, 'Could not retrieve test page!');
            return preq.post({
                uri: htmlUri,
                body: {
                    html: res.body.replace(/\<\/body\>/, '<p>Generated via direct HTML save!</p></body>'),
                    token: token,
                    revision: lastRev
                }
            });
        }).then(function(res) {
            assert.deepEqual(res.status, 201);
        });
    });
    */

});

