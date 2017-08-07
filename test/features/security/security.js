'use strict';

// mocha defines to avoid JSHint breakage
/* global describe, it, before, beforeEach, after, afterEach */

var assert = require('../../utils/assert.js');
var preq   = require('preq');
var server = require('../../utils/server.js');
var nock   = require('nock');
var P      = require('bluebird');

describe('router - security', function() {
    this.timeout(20000);

    before(function () {
        return server.start()
        .then(function() {
            // Do preparation requests to force siteInfo fetch so that we don't need to mock it
            return P.join(
                preq.get({
                    uri: server.config.baseURL + '/page/title/Main_Page'
                }),
                preq.get({
                    uri: server.config.secureURL + '/page/title/Wikipédia:Accueil_principal'
                })
            )
        });
    });

    var sampleRightsResponse = {
        batchcomplete: '',
        query: {
            userinfo: {
                id: 1,
                name: 'Petr',
                rights: ['createaccount','read','edit']
            }
        }
    };

    var sampleApiResponse = {
        query: {
            pages: {
                '1': {
                    ns: 0,
                    pageid: 1,
                    revisions: [1],
                    title: 'test'
                }
            }
        }
    };

    it('should forward cookies on request to api', function() {
        nock.enableNetConnect();
        var apiURI = server.config.secureApiURL;
        var api = nock(apiURI, {
            reqheaders: {
                cookie: 'test=test_cookie'
            }
        })
        .post('', function(body) { return body && body.generator === 'allpages'; })
        .reply(200, sampleApiResponse)
        .post('', function(body) { return body && body.meta === 'userinfo'; })
        .reply(200, sampleRightsResponse);

        return preq.get({
            uri: server.config.secureBucketURL + '/title/',
            headers: {
                'Cookie': 'test=test_cookie'
            }
        })
        .then(function() { api.done(); })
        .finally(function() { nock.cleanAll(); });
    });

    it('should forward cookies on request to parsoid', function() {
        nock.enableNetConnect();
        var parsoidURI = 'https://parsoid-beta.wmflabs.org';
        var title = 'Test';
        var revision = 117795883;
        var api = nock(parsoidURI, {
            reqheaders: {
                cookie: 'test=test_cookie'
            }
        })
        .get('/fr.wikipedia.org/v3/page/pagebundle/' + title + '/' + revision)
        .reply(200, function() {
            return {
                'html': {
                    'headers': {
                        'content-type': 'text/html'
                    },
                    'body': '<html></html>'
                },
                'data-parsoid': {
                    'headers': {
                        'content-type': 'application/json'
                    },
                    'body': {
                        'counter': 1,
                        'ids': {
                            'mwAA': {'dsr': [0, 1, 0, 0]}
                        },
                        'sectionOffsets': {
                            'mwAQ': {'html': [0, 1], 'wt': [2, 3]}
                        }
                    }
                }
            };
        });

        return preq.get({
            uri: server.config.secureBucketURL + '/html/' + title + '/' + revision,
            headers: {
                'Cookie': 'test=test_cookie',
                'Cache-control': 'no-cache'
            }
        })
        .then(function() { api.done(); })
        .finally(function() { nock.cleanAll(); });
    });

    it('should not forward cookies to external domains', function() {
        var externalURI = 'https://www.mediawiki.org';
        nock.enableNetConnect();
        var api = nock(externalURI, {
            badheaders: ['cookie'],
        })
        .get('/')
        .reply(200);

        return preq.get({
            uri: server.config.secureURL + '/http/' + encodeURIComponent(externalURI),
            headers: {
                'cookie': 'test=test_cookie'
            }
        })
        .then(function() { api.done(); })
        .finally(function() { nock.cleanAll(); });
    });


    it ('should not send cookies to non-restricted domains', function() {
        var apiURI = server.config.apiURL;
        var api = nock(apiURI, {
            badheaders: ['cookie']
        })
        .post('', function(body) { return body && body.generator === 'allpages'; })
        .reply(200, sampleApiResponse);

        return preq.get({
            uri: server.config.bucketURL + '/title/',
            headers: {
                'Cookie': 'test=test_cookie'
            }
        })
        .then(function() { api.done(); })
        .finally(function() { nock.cleanAll(); });
    });

    it('should deny access to resources stored in restbase', function() {
        nock.enableNetConnect();
        var apiURI = server.config.secureApiURL;
        var title = 'TestingTitle';
        var revision = 12345;

        var api = nock(apiURI)
        .post('')
        .reply(200, {
            'query': {
                'userinfo': {
                    'id': 1,
                    'name': 'test',
                    'rights': ['som right', 'some other right']
                }
            }
        });
        return preq.get({
            uri: server.config.secureBucketURL + '/title/' + title,
            headers: {
                'cache-control': 'no-cache'
            }
        })
        .then(function() {
            throw new Error('Access denied should be posted')
        })
        .catch(function(e) {
            assert.deepEqual(e.status, 401);
            assert.contentType(e, 'application/problem+json');
            assert.deepEqual(e.body.detail.indexOf('read') >= 0, true);
        })
        .then(function() {api.done(); })
        .finally(function() { nock.cleanAll();  });
    });
});
