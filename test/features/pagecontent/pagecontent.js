'use strict';

// mocha defines to avoid JSHint breakage
/* global describe, it, before, beforeEach, after, afterEach */

var assert = require('../../utils/assert.js');
var preq   = require('preq');
var server = require('../../utils/server.js');
var P      = require('bluebird');
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

    var rev2Etag;
    it('should transparently create data-parsoid with id 241155, rev 2', function() {
        return preq.get({
            uri: server.config.labsBucketURL + '/html/Foobar/241155'
        })
        .then(function(res) {
            assert.deepEqual(res.status, 200);
            rev2Etag = res.headers.etag.replace(/^"(.*)"$/, '$1');
        });
    });

    it('should return HTML and data-parsoid just created by revision 241155', function() {
        return preq.get({
            uri: server.config.labsBucketURL + '/html/Foobar/241155'
        })
        .then(function(res) {
            assert.deepEqual(res.status, 200);
            assert.contentType(res, contentTypes.html);
            return preq.get({
                uri: server.config.labsBucketURL + '/data-parsoid/Foobar/'
                    + res.headers.etag.replace(/^"(.*)"$/, '$1')
            });
        })
        .then(function(res) {
            assert.deepEqual(res.status, 200);
            assert.contentType(res, contentTypes['data-parsoid']);
        });
    });

    it('should return data-parsoid just created with revision 252937, rev 2', function() {
        return preq.get({
            uri: server.config.labsBucketURL + '/data-parsoid/Foobar/' + rev2Etag
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

    it('should retrieve all dependencies of the swagger-ui main page', function() {
        return preq.get({ uri: server.config.baseURL + '/?doc' })
        .then(function(res) {
            var assertions = [];
            var linkRegex = /<link\s[^>]*href=["']([^"']+)["']/g;
            var scriptRegex =  /<script\s[^>]*src=["']([^"']+)["']/g;
            var match;
            while (match = linkRegex.exec(res.body)) {
                assertions.push(match[1]);
            }
            while (match = scriptRegex.exec(res.body)) {
                assertions.push(match[1]);
            }
            return P.all(assertions.map(function(path) {
                return preq.get({ uri: server.config.baseURL + '/' + path })
                .then(function(res) {
                    assert.deepEqual(res.status, 200);
                });
            }));
        });
    });

    it('should retrieve domain listing in html', function() {
        return preq.get({
            uri: server.config.hostPort + '/',
            headers: {
                accept: 'text/html'
            }
        })
        .then(function(res) {
            assert.deepEqual(res.status, 200);
            assert.contentType(res, 'text/html');
            assert.deepEqual(/<html/.exec(res.body)[0], '<html');
        });
    });

    it('should retrieve API listing in html', function() {
        return preq.get({
            uri: server.config.hostPort + '/en.wikipedia.org/',
            headers: {
                accept: 'text/html'
            }
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

    it('should list revisions for a title', function() {
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

    it('should redirect to commons for missing file pages', function() {
        return preq.get({
            uri: server.config.bucketURL + '/html/File:ThinkingMan_Rodin.jpg',
            headers: {
                'user-agent': 'WikipediaApp/2.1.141-beta-2016-02-10 (Android 5.0.2; Phone) Google Play Beta Channel'
            }
        })
        .then(function(res) {
            assert.deepEqual(res.status, 200);
            assert.deepEqual(res.headers['content-location'],
                'https://commons.wikimedia.org/api/rest_v1/page/html/File%3AThinkingMan_Rodin.jpg');
        });
    });

    it('should not redirect if file is missing on commons', function() {
        return preq.get({
            uri: server.config.hostPort +
                '/commons.wikimedia.org/v1/html/File:Some_File_That_Does_Not_Exist.jpg'
        })
        .then(function() {
            throw new Error('Error should be thrown');
        }, function(e) {
            assert.deepEqual(e.status, 404);
        });
    });
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
        var listURL = [server.config.bucketURL, 'data-parsoid', deniedTitle, deniedRev, ''].join('/');
        return preq.get({ uri: listURL })
        .then(function(res) {
            var deniedRevisions = res.body.items.filter(function(item) {
                return item.revision === deniedRev;
            });

            if (deniedRevisions.length > 0) {
                throw new Error('Expected no suppressed data-parsoid revisions to be stored');
            }
        });
    });

    it('Should throw error for invalid title access', function() {
        return preq.get({
            uri: server.config.bucketURL + '/html/[asdf]'
        })
        .then(function() {
            throw new Error('Error should be thrown')
        }, function(e) {
            assert.deepEqual(e.status, 400);
            assert.deepEqual(e.body.detail, 'title-invalid-characters');
        });
    });

    it('Should redirect to a normalized version of a title', function() {
        return preq.get({
            uri: server.config.bucketURL + '/html/Main%20Page?test=mwAQ'
        })
        .then(function(res) {
            assert.deepEqual(res.status, 200);
            assert.deepEqual(res.headers['content-location'], server.config.bucketURL
                + '/html/Main_Page?test=mwAQ');
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
