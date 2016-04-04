'use strict';

// mocha defines to avoid JSHint breakage
/* global describe, it, before, beforeEach, after, afterEach */

var assert = require('../../utils/assert.js');
var preq   = require('preq');
var server = require('../../utils/server.js');
var nock = require('nock');

describe('Access checks', function() {

    before(function() {
        return server.start()
        .then(function() {
            // Do a preparation request to force siteinfo fetch so that we don't need to mock it
            return preq.get({
                uri: server.config.bucketURL + '/html/Main_Page'
            });
        })
        .then(function() {
            return preq.get({
                uri: server.config.labsBucketURL + '/html/Main_Page'
            });
        });
    });

    var deletedPageTitle = 'User:Pchelolo/Access_Check_Tests';
    var deletedPageOlderRevision = 705347919;
    var deletedPageRevision = 705347950;
    var emptyResponse = {'batchcomplete': '', 'query': {'badrevids': {'292466': {'revid': '292466'}}}};

    it('should understand the page was deleted', function() {
        // Do a preparation request to force siteinfo fetch

        var api = nock(server.config.apiURL)
        // The first request should return a page so that we store it.
        .post('')
        .reply(200, {
            'batchcomplete': '',
            'query': {
                'pages': {
                    '49453581': {
                        'pageid': 49453581,
                        'ns': 0,
                        'title': deletedPageTitle,
                        'contentmodel': 'wikitext',
                        'pagelanguage': 'en',
                        'touched': '2015-05-22T08:49:39Z',
                        'lastrevid': deletedPageRevision,
                        'length': 2941,
                        'revisions': [{
                            'revid': deletedPageRevision,
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
        })
        // TEMP: summary also needs update		
        .post('').reply(200, {
            'batchcomplete': '',
            'query': {
                'pages': {
                    '11089416': {
                        'title': deletedPageTitle,
                        'extract': 'test'
                    }
                }
            }
        })
        // Other requests return nothing as if the page is deleted.
        .post('').reply(200, emptyResponse);
        // Fetch the page
        return preq.get({
            uri: server.config.bucketURL + '/html/' + encodeURIComponent(deletedPageTitle),
        })
        .then(function(res) {
            assert.deepEqual(res.status, 200);
            // Now fetch info that it's deleted
            return preq.get({
                uri: server.config.bucketURL + '/title/' + encodeURIComponent(deletedPageTitle),
                headers: {
                    'cache-control': 'no-cache'
                }
            });
        })
        .then(function() {
            throw new Error('404 should have been returned for a deleted page');
        }, function(e) {
            assert.deepEqual(e.status, 404);
            assert.contentType(e, 'application/problem+json');
        })
        .then(function() {
            api.done();
        })
        .finally(function() {
            nock.cleanAll();
        });
    });

    it('should restrict access to deleted page latest revision', function() {
        // This is only required until the hack for no-cache header is in place
        var api = nock(server.config.apiURL)
        .post('').reply(200, emptyResponse);

        return preq.get({uri: server.config.bucketURL + '/revision/' + deletedPageRevision})
        .then(function() {
            throw new Error('404 should have been returned for a deleted page');
        }, function(e) {
            assert.deepEqual(e.status, 404);
            assert.contentType(e, 'application/problem+json');
        })
        .then(function() {
            api.done();
        })
        .finally(function() {
            nock.cleanAll();
        });
    });

    it('should restrict access to older revision of a deleted page', function() {
        // This is only required until the hack for no-cache header is in place
        var api = nock(server.config.apiURL)
        .post('').reply(200, emptyResponse);

        return preq.get({uri: server.config.bucketURL + '/revision/' + deletedPageOlderRevision})
        .then(function() {
            throw new Error('404 should have been returned for a deleted page');
        }, function(e) {
            assert.deepEqual(e.status, 404);
            assert.contentType(e, 'application/problem+json');
        })
        .then(function() {
            api.done();
        })
        .finally(function() {
            nock.cleanAll();
        });
    });

    function testAccess(content_variant, restriction_type, title, rev) {
        var name = 'should restrict access to ' + restriction_type + ' page ';
        name += !!rev ? 'older revision' : 'latest';
        name += ' ' + content_variant;
        it(name, function() {
            // Check that access is enforced to html
            var uri = server.config.bucketURL + '/' + content_variant + '/' + encodeURIComponent(title);
            if (rev) {
                uri += '/' + rev;
            }
            return preq.get({uri: uri})
            .then(function() {
                throw new Error('404 should have been returned for a deleted page');
            }, function(e) {
                assert.deepEqual(e.status, 404);
                assert.contentType(e, 'application/problem+json');
            });
        });
    }

    testAccess(deletedPageTitle, 'deleted', 'html');
    testAccess(deletedPageTitle, 'deleted', 'data-parsoid');
    /* TODO: This access control check doesn't work yet
     testAccess(deletedPageTitle, 'deleted', 'html', deletedPageOlderRevision);
     testAccess(deletedPageTitle, 'deleted', 'data-parsoid', deletedPageOlderRevision);
     */
    testAccess(deletedPageTitle, 'deleted', 'mobile-sections');
    testAccess(deletedPageTitle, 'deleted', 'mobile-sections-lead');
    testAccess(deletedPageTitle, 'deleted', 'mobile-sections-remaining');
    testAccess(deletedPageTitle, 'deleted', 'summary');

    var pageTitle = 'User:Pchelolo/restriction_testing_mock';
    var pageRev = 301375;
    it('should correctly fetch updated restrictions', function() {
        var normalRev = {
            "revid": pageRev,
            "user": "Pchelolo",
            "userid": 6591,
            "timestamp": "2015-02-03T21:15:55Z",
            "size": 7700,
            "contentmodel": "wikitext",
            "tags": []
        };
        var normalResponse = {
            "pageid": 152993,
            "ns": 3,
            "title": "User:Pchelolo/restriction_testing_mock",
            "contentmodel": "wikitext",
            "pagelanguage": "en",
            "pagelanguagehtmlcode": "en",
            "pagelanguagedir": "ltr",
            "touched": "2015-12-10T23:41:54Z",
            "lastrevid": pageRev,
            "length": 23950,
            "revisions": [normalRev]
        };
        var restrictedRev = Object.assign({}, normalRev);
        restrictedRev.texthidden = true;
        restrictedRev.sha1hidden = true;
        var restrictedResponse = Object.assign({}, normalResponse);
        restrictedResponse.revisions = [restrictedRev];
        var api = nock(server.config.labsApiURL)
        .post('').reply(200, {
            "batchcomplete": "",
            "query": {"pages": {"45161196": normalResponse}}
        }).post('').reply(200, {
            "batchcomplete": "",
            "query": {"pages": {"45161196": restrictedResponse}}
        });

        // First fetch a non-restricted revision
        return preq.get({
            uri: server.config.labsBucketURL + '/title/' + encodeURIComponent(pageTitle)
        })
        .then(function(res) {
            assert.deepEqual(res.status, 200);
            assert.deepEqual(res.body.items.length, 1);
            // Now fetch update with restrictions
            return preq.get({
                uri: server.config.labsBucketURL + '/title/' + encodeURIComponent(pageTitle),
                headers: {
                    'cache-control': 'no-cache'
                }
            });
        }).then(function() {
            throw new Error('403 should be thrown');
        }, function(e) {
            assert.deepEqual(e.status, 403);
        }).then(function() {
            api.done();
        })
        .finally(function() {
            nock.cleanAll();
        });
    });


    // FIXME: Test disabled until cached responses are once again used (see: T120212).
    it.skip('should store updated restrictions', function() {
        return preq.get({
            uri: server.config.labsBucketURL + '/title/' + encodeURIComponent(pageTitle)
        })
        .then(function() {
            throw new Error('403 should be thrown');
        }, function(e) {
            assert.deepEqual(e.status, 403);
        });
    });

    testAccess(pageTitle, 'restricted', 'html', pageRev);
    testAccess(pageTitle, 'restricted', 'data-parsoid', pageRev);
});
