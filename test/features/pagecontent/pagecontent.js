'use strict';

// mocha defines to avoid JSHint breakage
/* global describe, it, before, beforeEach, after, afterEach */

var assert = require('../../utils/assert.js');
var preq   = require('preq');
var server = require('../../utils/server.js');
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
        });
    });
    it('should transparently create a new HTML revision with id 624484477', function() {
        return preq.get({
            uri: server.config.bucketURL + '/html/Foobar/624484477',
            body: 'Hello there'
        })
        .then(function(res) {
            assert.deepEqual(res.status, 200);
        });
    });
    it('should transparently create data-parsoid with id 624165266, rev 2', function() {
        return preq.get({
            uri: server.config.bucketURL + '/html/Foobar/624165266'
        })
        .then(function(res) {
            assert.deepEqual(res.status, 200);
        });
    });
    it('should return HTML just created by revision 624165266', function() {
        return preq.get({
            uri: server.config.bucketURL + '/html/Foobar/624165266'
        })
        .then(function(res) {
            assert.deepEqual(res.status, 200);
            assert.contentType(res, contentTypes.html);
        });
    });
    it('should return data-parsoid just created by revision 624165266, rev 2', function() {
        return preq.get({
            uri: server.config.bucketURL + '/data-parsoid/Foobar/624165266'
        })
        .then(function(res) {
            assert.deepEqual(res.status, 200);
            assert.contentType(res, contentTypes['data-parsoid']);
        });
    });

    it('should return data-parsoid just created with revision 624484477, rev 2', function() {
        return preq.get({
            uri: server.config.bucketURL + '/data-parsoid/Foobar/624484477'
        })
        .then(function(res) {
            assert.deepEqual(res.status, 200);
            assert.contentType(res, contentTypes['data-parsoid']);
        });
    });

    it('should return sections of Main_Page', function() {
        return preq.get({
            uri: server.config.bucketURL + '/html/Main_Page/664887982',
            query: {
                sections: 'mp-topbanner,mp-upper'
            },
        })
        .then(function(res) {
            assert.deepEqual(res.status, 200);
            assert.contentType(res, 'application/json');
            var body = res.body;
            if (!body['mp-topbanner'] || typeof body['mp-topbanner'] !== 'string'
                    || !body['mp-upper']) {
                throw new Error('Missing section content!');
            }
        })
        .then(function() {
            return preq.get({
                uri: server.config.bucketURL + '/html/Main_Page',
                query: {
                    sections: 'mp-topbanner'
                },
            });
        })
        .then(function(res) {
            assert.deepEqual(res.status, 200);
            assert.contentType(res, 'application/json');
            var body = res.body;
            if (!body['mp-topbanner'] || typeof body['mp-topbanner'] !== 'string') {
                throw new Error('Missing section content!');
            }
        });
    });

    it('section retrieval: error handling', function() {
        return preq.get({
            uri: server.config.bucketURL + '/html/Main_Page/664887982',
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
            uri: server.config.hostPort + '/en.wikipedia.test.local/'
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

    it('should list revisions for a title', function() {
        return preq.get({
            uri: server.config.bucketURL + '/title/Foobar/'
        })
        .then(function(res) {
            assert.deepEqual(res.status, 200);
            assert.contentType(res, 'application/json');
            assert.deepEqual(res.body.items, [624484477]);
            pagingToken = res.body._links.next.href;
        });
    });

    it('should list next set of revisions for a title using pagination', function() {
        return preq.get({
            uri: server.config.bucketURL + '/title/Foobar/' + pagingToken
        })
        .then(function(res) {
            assert.deepEqual(res.status, 200);
            assert.contentType(res, 'application/json');
            assert.deepEqual(res.body.items, [624165266]);
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
