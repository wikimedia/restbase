'use strict';

// mocha defines to avoid JSHint breakage
/* global describe, it, before, beforeEach, after, afterEach */

var assert = require('../../utils/assert.js');
var preq   = require('preq');
var server = require('../../utils/server.js');
var nock   = require('nock');
var pagingToken = '';

describe('item requests', function() {
    this.timeout(20000);

    before(function () { return server.start(); });

    var contentTypes = server.config.conf.test.content_types;

    it('should respond to OPTIONS request with CORS headers', function() {
        return preq.options({ uri: server.config.bucketURL + '/html/Foobar/624484477' })
        .then(function(res) {
            assert.deepEqual(res.status, 200);
            assert.deepEqual(res.headers['access-control-allow-origin'], '*');
            assert.deepEqual(res.headers['access-control-allow-methods'], 'GET');
            assert.deepEqual(res.headers['access-control-allow-headers'], 'accept, content-type');
            assert.deepEqual(res.headers['access-control-expose-headers'], 'etag');
        });
    });
    it('should transparently create a new HTML revision for Main_Page', function() {
        return preq.get({
            uri: server.config.labsBucketURL + '/html/Main_Page',
        })
        .then(function(res) {
            assert.deepEqual(res.status, 200);
            return preq.get({
                uri: server.config.labsBucketURL + '/html/Main_Page/'
            });
        })
        .then(function(res) {
            if (res.body.items.length !== 1) {
                throw new Error('Expected a single revision for Main_Page');
            }
        });
    });
    it('should transparently create a new HTML revision with id 252937', function() {
        return preq.get({
            uri: server.config.labsBucketURL + '/html/Foobar/252937',
        })
        .then(function(res) {
            assert.deepEqual(res.status, 200);
        });
    });
    it('should transparently create data-parsoid with id 241155, rev 2', function() {
        return preq.get({
            uri: server.config.labsBucketURL + '/html/Foobar/241155'
        })
        .then(function(res) {
            assert.deepEqual(res.status, 200);
        });
    });
    it('should return HTML just created by revision 241155', function() {
        return preq.get({
            uri: server.config.labsBucketURL + '/html/Foobar/241155'
        })
        .then(function(res) {
            assert.deepEqual(res.status, 200);
            assert.contentType(res, contentTypes.html);
        });
    });
    it('should return data-parsoid just created by revision 241155, rev 2', function() {
        return preq.get({
            uri: server.config.labsBucketURL + '/data-parsoid/Foobar/241155'
        })
        .then(function(res) {
            assert.deepEqual(res.status, 200);
            assert.contentType(res, contentTypes['data-parsoid']);
        });
    });

    it('should return data-parsoid just created with revision 252937, rev 2', function() {
        return preq.get({
            uri: server.config.labsBucketURL + '/data-parsoid/Foobar/252937'
        })
        .then(function(res) {
            assert.deepEqual(res.status, 200);
            assert.contentType(res, contentTypes['data-parsoid']);
        });
    });

    it('should return sections of Main_Page', function() {
        return preq.get({
            uri: server.config.labsBucketURL + '/html/Main_Page/262492',
            query: {
                sections: 'mp-sister,mp-lang'
            },
            headers: {
                'cache-control': 'no-cache'
            }
        })
        .then(function(res) {
            assert.deepEqual(res.status, 200);
            assert.contentType(res, 'application/json');
            var body = res.body;
            if (!body['mp-sister'] || typeof body['mp-sister'] !== 'string'
                    || !body['mp-lang']) {
                throw new Error('Missing section content!');
            }
            return preq.get({
                uri: server.config.labsBucketURL + '/html/Main_Page',
                query: {
                    sections: 'mp-sister'
                },
            });
        })
        .then(function(res) {
            assert.deepEqual(res.status, 200);
            assert.contentType(res, 'application/json');
            var body = res.body;
            if (!body['mp-sister'] || typeof body['mp-sister'] !== 'string') {
                throw new Error('Missing section content!');
            }
        });
    });

    it('should get sections of Main_Page with no-cache and unchanged render', function() {
        return preq.get({
            uri: server.config.labsBucketURL + '/html/Main_Page',
            query: {
                sections: 'mp-sister,mp-lang'
            },
            headers: {
                'cache-control': 'no-cache'
            }
        })
        .then(function(res) {
            assert.deepEqual(res.status, 200);
            assert.contentType(res, 'application/json');
            var body = res.body;
            if (!body['mp-sister'] || typeof body['mp-sister'] !== 'string'
            || !body['mp-lang']) {
                throw new Error('Missing section content!');
            }
        });
    });

    it('section retrieval: error handling', function() {
        return preq.get({
            uri: server.config.labsBucketURL + '/html/Main_Page/262492',
            query: {
                sections: 'somethingThatDoesNotExist'
            },
        })
        .then(function(res) {
            throw new Error('Request should return status 400');
        }, function(res) {
            assert.deepEqual(res.status, 400);
        });
    });

    it('should list APIs using the generic listing handler', function() {
        return preq.get({
            uri: server.config.hostPort + '/en.wikipedia.org/'
        })
        .then(function(res) {
            assert.deepEqual(res.status, 200);
            assert.contentType(res, 'application/json');
            assert.deepEqual(res.body, {
                items: ['sys', 'v1' ]
            });
        });
    });

    it('should retrieve the spec', function() {
        return preq.get({
            uri: server.config.baseURL + '/?spec'
        })
        .then(function(res) {
            assert.deepEqual(res.status, 200);
            assert.contentType(res, 'application/json');
            assert.deepEqual(res.body.swagger, '2.0');
        });
    });

    it('should retrieve the swagger-ui main page', function() {
        return preq.get({
            uri: server.config.baseURL + '/?doc'
        })
        .then(function(res) {
            assert.deepEqual(res.status, 200);
            assert.contentType(res, 'text/html');
            assert.deepEqual(/<html/.exec(res.body)[0], '<html');
        });
    });

    it('should list page titles', function() {
        return preq.get({
            uri: server.config.bucketURL + '/title/'
        })
        .then(function(res) {
            assert.deepEqual(res.status, 200);
            assert.contentType(res, 'application/json');
            if (!res.body.items || !res.body.items.length) {
                throw new Error("Empty listing result!");
            }
            if (!/^!/.test(res.body.items[0])) {
                throw new Error("Expected the first titles to start with !");
            }
            pagingToken = res.body._links.next.href;
       });
    });


    it('should list another set of page titles using pagination', function() {
        return preq.get({
            uri: server.config.bucketURL + '/title/' + pagingToken,
        })
        .then(function(res) {
            assert.deepEqual(res.status, 200);
            assert.contentType(res, 'application/json');
            if (!res.body.items || !res.body.items.length) {
                throw new Error("Empty listing result!");
            }
        });
    });

   /* it('should list revisions for a title', function() {
        return preq.get({
            uri: server.config.labsBucketURL + '/title/Foobar/'
        })
        .then(function(res) {
            assert.deepEqual(res.status, 200);
            assert.contentType(res, 'application/json');
            assert.deepEqual(res.body.items, [252937]);
            pagingToken = res.body._links.next.href;
        });
    });

    it('should list next set of revisions for a title using pagination', function() {
        return preq.get({
            uri: server.config.labsBucketURL + '/title/Foobar/' + pagingToken
        })
        .then(function(res) {
            assert.deepEqual(res.status, 200);
            assert.contentType(res, 'application/json');
            assert.deepEqual(res.body.items, [241155]);
        });
    });*/

    function responseWithTitleRevision(title, revision) {
        return {
            'batchcomplete': '',
            'query': {
                'pages': {
                    '11089416': {
                        'pageid': 11089416,
                        'ns': 0,
                        'title': title,
                        'contentmodel': 'wikitext',
                        'pagelanguage': 'en',
                        'touched': '2015-05-22T08:49:39Z',
                        'lastrevid': 653508365,
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
        };
    }

    // Nock is needed here, because the page are already renamed in MW API,
    // but we need to pretend it's happening while renaming.
    it('should not store duplicated revison on rename', function() {
        var apiURI = server.config
            .conf.templates['wmf-sys-1.0.0']
            .paths['/{module:action}']['x-modules'][0].options.apiRequest.uri;
        apiURI = apiURI.replace('{domain}', 'en.wikipedia.org');
        nock.enableNetConnect();
        var api = nock(apiURI)
        .post('').reply(200, responseWithTitleRevision('User:Pchelolo/Before_Rename', 679398266))
        .post('').reply(200, responseWithTitleRevision('User:Pchelolo/After_Rename', 679398351));
        return preq.get({
            uri: server.config.bucketURL + '/html/User:Pchelolo%2fBefore_Rename/679398266',
            headers: {
                'cache-control': 'no-cache'
            }
        })
        .then(function(res) {
            assert.deepEqual(res.status, 200);
            return preq.get({
                uri: server.config.bucketURL + '/html/User:Pchelolo%2fAfter_Rename/679398351',
                headers: {
                    'cache-control': 'no-cache',
                    'x-restbase-parentrevision': 679398266,
                    'x-restbase-parenttitle': 'User:Pchelolo/Before_Rename'
                }
            });
        })
        .then(function(res) {
            assert.deepEqual(res.status, 200);
            return preq.get({
                uri: server.config.bucketURL + '/title/User:Pchelolo%2fAfter_Rename/'
            })
        })
        .then(function(res) {
            assert.deepEqual(res.status, 200);
            assert.deepEqual(res.body.items.length, 1);
            assert.deepEqual(res.body.items[0], 679398351);
            if (res.body.next) {
                return preq.get({
                    uri: server.config.bucketURL
                            + '/title/User:Pchelolo%2fAfter_Rename/'
                            + res.body._links.next.href
                })
                .then(function() {
                    throw new Error('Only one revision should be stored.');
                })
                .catch(function(e) {
                    assert.deepEqual(e.status, 404);
                });
            }
        })
        .then(function() { api.done(); })
        .finally(function() {nock.cleanAll()});
    });

    it('should track renames and restric access to older content', function() {
        return preq.get({
            uri: server.config.bucketURL + '/html/User:Pchelolo%2fBefore_Rename',
            headers: {
                'cache-control': 'no-cache'
            }
        })
        .then(function(res) {
            assert.deepEqual(res.status, 200);
            assert.deepEqual(res.headers['content-location'],
                server.config.bucketURL + '/html/User%3APchelolo%2FAfter_Rename');
        });
    });

    it('should allow creating new pages instead of renamed', function() {
        // A 'redirect' page was created for this page, need to be able to add it too
        return preq.get({
            uri: server.config.bucketURL + '/html/User:Pchelolo%2fBefore_Rename/679398352',
            headers: {
                'cache-control': 'no-cache'
            }
        })
        .then(function(res) {
            assert.deepEqual(res.status, 200);
            return preq.get({
                uri: server.config.bucketURL + '/title/User:Pchelolo%2fBefore_Rename'
            });
        })
        .then(function(res) {
            assert.deepEqual(res.status, 200);
            assert.deepEqual(res.body.items.length, 1);
            assert.deepEqual(res.body.items[0].rev, 679398352);
        });
    });

    it('should return the lastest page title', function() {
        var apiURI = server.config
            .conf.templates['wmf-sys-1.0.0']
            .paths['/{module:action}']['x-modules'][0].options.apiRequest.uri;
        apiURI = apiURI.replace('{domain}', 'en.wikipedia.org');
        nock.enableNetConnect();
        var api = nock(apiURI)
        .post('').reply(200, responseWithTitleRevision('User:Pchelolo/Renames1', 685356037))
        .post('').reply(200, responseWithTitleRevision('User:Pchelolo/Renames2', 685357564))
        .post('').reply(200, responseWithTitleRevision('User:Pchelolo/Renames3', 685357639));

        return preq.get({
            uri: server.config.bucketURL + '/html/User:Pchelolo%2fRenames1/685356037',
            headers: {
                'cache-control': 'no-cache'
            }
        })
        .then(function(res) {
            assert.deepEqual(res.status, 200);
            return preq.get({
                uri: server.config.bucketURL + '/html/User:Pchelolo%2fRenames2/685357564',
                headers: {
                    'cache-control': 'no-cache',
                    'x-restbase-parenttitle': 'User:Pchelolo/Renames1',
                    'x-restbase-parentrevision': '685356037'
                }
            });
        })
        .then(function(res) {
            assert.deepEqual(res.status, 200);
            return preq.get({
                uri: server.config.bucketURL + '/html/User:Pchelolo%2fRenames3/685357639',
                headers: {
                    'cache-control': 'no-cache',
                    'x-restbase-parenttitle': 'User:Pchelolo/Renames2',
                    'x-restbase-parentrevision': '685357564'
                }
            });
        })
        .then(function(res) {
            assert.deepEqual(res.status, 200);
            return preq.get({
                uri: server.config.bucketURL + '/title/User:Pchelolo%2fRenames1'
            })
            .then(function(res) {
                assert.deepEqual(res.status, 200);
                assert.deepEqual(res.body.items[0].title, 'User:Pchelolo/Renames3');
                assert.deepEqual(res.body.items[0].rev, 685357639);
                assert.deepEqual(res.headers['content-location'],
                    server.config.bucketURL + '/title/User%3APchelolo%2FRenames3');
            });
        })
        .then(function() { api.done(); })
        .finally(function() { nock.cleanAll(); });
    });

    //it('should return a new wikitext revision using proxy handler with id 624165266', function() {
    //    this.timeout(20000);
    //    return preq.get({
    //        uri: server.config.baseURL + '/test/Foobar/wikitext/624165266'
    //    })
    //    .then(function(res) {
    //        assert.deepEqual(res.status, 200);
    //    });
    //});

});

describe('page content access', function() {

    var deniedTitle = 'User%20talk:DivineAlpha';
    var deniedRev = '645504917';

    this.timeout(30000);

    function contentURI(format) {
        return [server.config.bucketURL, format, deniedTitle, deniedRev].join('/');
    }

    it('should deny access to the HTML of a restricted revision', function() {
        return preq.get({ uri: contentURI('html') }).then(function(res) {
            throw new Error('Expected status 403, but gotten ' + res.status);
        }, function(res) {
            assert.deepEqual(res.status, 403);
        });
    });

    it('should deny access to the same HTML even after re-fetching it', function() {
        return preq.get({
            uri: contentURI('html'),
            headers: { 'cache-control': 'no-cache' }
        }).then(function(res) {
            throw new Error('Expected status 403, but gotten ' + res.status);
        }, function(res) {
            assert.deepEqual(res.status, 403);
        });
    });

    it('should deny access to the data-parsoid of a restricted revision', function() {
        return preq.get({ uri: contentURI('data-parsoid') }).then(function(res) {
            throw new Error('Expected status 403, but gotten ' + res.status);
        }, function(res) {
            assert.deepEqual(res.status, 403);
        });
    });

});

describe('page content hierarchy', function() {
    this.timeout(20000);
    it('should list available properties', function() {
        return preq.get({
            uri: server.config.bucketURL + '/',
        })
        .then(function(res) {
            assert.deepEqual(res.status, 200);
            if (!res.body.items || res.body.items.indexOf('html') === -1) {
                throw new Error('Expected property listing that includes "html"');
            }
        });
    });
});
