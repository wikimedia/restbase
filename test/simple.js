'use strict';

/*
 * Simple API tests
 */

/*
 * Could also check out the nock package to record / replay http interactions
 */

// mocha defines to avoid JSHint breakage
/* global describe, it, before, beforeEach, after, afterEach */

var restbase = require('../lib/server.js');
var preq = require('preq');
var assert = require('assert');
var hostPort = 'http://localhost:7231';
var baseURL = hostPort + '/v1/en.wikipedia.org';
var bucketURL = baseURL + '/test101';

var closeRestbase;

function deepEqual (result, expected) {
    try {
        assert.deepEqual(result, expected);
    } catch (e) {
        console.log('Expected:\n' + JSON.stringify(expected,null,2));
        console.log('Result:\n' + JSON.stringify(result,null,2));
        throw e;
    }
}

Promise.prototype.fails = function(onRejected) {
    var failed = false;
    function trackFailure(e) {
        failed = true;
        return onRejected(e);
    }
    function check(x) {
        if (!failed) {
            throw new Error('expected error was not thrown');
        } else {
            return this;
        }
    }
    return this.catch(trackFailure).then(check);
};

function commonTests() {
    it('should return HTML just created with revision 624484477', function() {
        return preq.get({
            uri: bucketURL + '/Foobar/html/624484477'
        })
        .then(function(res) {
            deepEqual(res.status, 200);
        });
    });
    it('should return HTML just created by revision 624165266', function() {
        return preq.get({
            uri: bucketURL + '/Foobar/html/624165266'
        })
        .then(function(res) {
            deepEqual(res.status, 200);
            deepEqual(res.headers['content-type'], 'text/html; charset=UTF-8');
        });
    });
    it('should return data-parsoid just created by revision 624165266, rev 2', function() {
        return preq.get({
            uri: bucketURL + '/Foobar/data-parsoid/624165266'
        })
        .then(function(res) {
            deepEqual(res.status, 200);
            deepEqual(res.headers['content-type'], 'application/json; profile=mediawiki.org/specs/data-parsoid/1.0');
        });
    });

    it('should return data-parsoid just created with revision 624484477, rev 2', function() {
        return preq.get({
            uri: bucketURL + '/Foobar/data-parsoid/624484477'
        })
        .then(function(res) {
            deepEqual(res.status, 200);
            deepEqual(res.headers['content-type'], 'application/json; profile=mediawiki.org/specs/data-parsoid/1.0');
        });
    });

}

describe('Simple API tests', function () {
    this.timeout(20000);
    before(function() {
        return restbase({
            logging: {
                name: 'restbase-tests',
                level: 'warn'
            }
        }).then(function(server){
            closeRestbase = function () { server.close(); };
        });
    });
    describe('Domain & bucket creation', function() {
        it('should create a domain', function() {
            return preq.put({
                uri: hostPort + '/v1/en.wikipedia.org',
                headers: { 'content-type': 'application/json' },
                body: {}
            })
            .then(function(res) {
                deepEqual(res.status, 201);
            });
        });
    });
    describe('Bucket creation', function() {
        it('should require a bucket type', function() {
            this.timeout(20000);
            return preq.put({
                uri: bucketURL,
                headers: { 'content-type': 'application/json' },
                body: {}
            })
            .fails(function(e) {
                deepEqual(e.status, 400);
                deepEqual(e.body.title, 'Invalid bucket spec.');
            });
        });
        it('should require a valid bucket type', function() {
            this.timeout(20000);
            return preq.put({
                uri: bucketURL,
                headers: { 'content-type': 'application/json' },
                body: { type: 'wazzle' }
            })
            .fails(function(e) {
                deepEqual(e.status, 400);
                deepEqual(e.body.title, 'Invalid bucket spec.');
            });
        });
        it('should create a page bucket', function() {
            this.timeout(20000);
            return preq.put({
                uri: bucketURL,
                headers: { 'content-type': 'application/json' },
                body: { type: 'pagecontent' }
            })
            .then(function(res) {
                deepEqual(res.status, 201);
            });
        });
    });
    describe('Item requests', function() {
        //it('should not accept a new html save without a revision', function() {
        //    return preq.put({
        //        uri: bucketURL + '/Foo/html',
        //        headers: { 'content-type': 'text/html' },
        //        body: 'Hello there'
        //    })
        //    .then(function(res) {
        //        deepEqual(res.status, 404);
        //    });
        //});
        it('should transparently create a new HTML revision with id 624484477', function() {
            this.timeout(20000);
            return preq.get({
                uri: bucketURL + '/Foobar/html/624484477',
                headers: { 'content-type': 'text/html' },
                body: 'Hello there'
            })
            .then(function(res) {
                deepEqual(res.status, 200);
            });
        });
        it('should transparently create data-parsoid with id 624165266, rev 2', function() {
            this.timeout(20000);
            return preq.get({
                uri: bucketURL + '/Foobar/html/624165266'
            })
            .then(function(res) {
                deepEqual(res.status, 200);
            });
        });
        it('should transparently create a new wikitext revision using proxy handler with id 624484477', function() {
            this.timeout(20000);
            return preq.get({
                uri: baseURL + '/Foobar/wikitext/624484477',
                headers: { 'content-type': 'text/wikitext' },
                body: 'Hello there'
            })
            .then(function(res) {
                deepEqual(res.status, 200);
            });
        });
        commonTests();
        it('should accept a new html save with a revision', function() {
            return preq.put({
                uri: bucketURL + '/Foobar/html/76f22880-362c-11e4-9234-0123456789ab',
                headers: { 'content-type': 'text/html; charset=UTF-8' },
                body: 'Hello there'
            })
            .then(function(res) {
                deepEqual(res.status, 201);
            })
            .catch(function(e) {
                console.dir(e);
                throw e;
            });
        });
        it('should return the HTML revision just created', function() {
            return preq.get({
                uri: bucketURL + '/Foobar/html/624484477'
            })
            .then(function(res) {
                deepEqual(res.status, 200);
                deepEqual(res.headers['content-type'], 'text/html; charset=UTF-8');
                deepEqual(res.headers.etag, '76f22880-362c-11e4-9234-0123456789ab');
                deepEqual(res.body, 'Hello there');
            });
        });
    });
    describe('404 handling', function() {
        it('should return a proper 404 when trying to retrieve a non-existing domain', function() {
            return preq.get({
                uri: hostPort + '/v1/foobar.com'
            })
            .catch(function(e) {
                deepEqual(e.status, 404);
                deepEqual(e.headers['content-type'], 'application/problem+json');
            });
        });
        it('should return a proper 404 when trying to list a non-existing domain', function() {
            return preq.get({
                uri: hostPort + '/v1/foobar.com/'
            })
            .catch(function(e) {
                deepEqual(e.status, 404);
                deepEqual(e.headers['content-type'], 'application/problem+json');
            });
        });
        it('should return a proper 404 when accessing an unknown bucket', function() {
            return preq.get({
                uri: baseURL + '/some_nonexisting_bucket'
            })
            .catch(function(e) {
                deepEqual(e.status, 404);
                deepEqual(e.headers['content-type'], 'application/problem+json');
            });
        });
        it('should return a proper 404 when trying to list an unknown bucket', function() {
            return preq.get({
                uri: baseURL + '/some_nonexisting_bucket/'
            })
            .catch(function(e) {
                deepEqual(e.status, 404);
                deepEqual(e.headers['content-type'], 'application/problem+json');
            });
        });
        it('should return a proper 404 when accessing an item in an unknown bucket', function() {
            return preq.get({
                uri: baseURL + '/some_nonexisting_bucket/item'
            })
            .catch(function(e) {
                deepEqual(e.status, 404);
                deepEqual(e.headers['content-type'], 'application/problem+json');
            });
        });
    });
});

describe('Phase 2 - running tests with a restart', function() {
    this.timeout(20000);
    setTimeout(function() {}, 5000);
    before(function() {
        closeRestbase();
        return restbase({
            logging: {
                name: 'restbase-tests',
                level: 'warn'
            }
        });
    });
    describe('It should pass some tests from phase 1', function() {
        commonTests();
    });
});

describe('automated specification tests', function() {
    this.timeout(20000);
    setTimeout(function() {}, 5000);

    var yaml = require('js-yaml');
	  var template = require('url-template');
    var http = require('http');

    function flatMap(f, xs) {
        var ys = [];
        for (var k in xs) {
            ys = ys.concat(f(k, xs[k]));
        }
        return ys;
    }

    function createPrereqsFromXample(xample) {
        var prereqs = Promise.resolve({});
        if (xample.prerequisites) {
            xample.prerequisites.forEach(function (prerequisite) {
                prerequisite.uri = baseURL + prerequisite.uri;
                prereqs = prereqs.then(function () {
                    return preq[prerequisite.method](prerequisite);
                });
            });
        }
        return prereqs;
    }
    
    function createTestFromXample(basePath, method, uri) {
        return function(xample) {
            var test = {
                desc: method + ' ' + uri,
                body: function () {
                    var prereqs = createPrereqsFromXample(xample);
                    return prereqs.then(function () {
                        xample.request.method = method;
                        var urlTemplate = template.parse(uri);
                        xample.request.uri = hostPort + basePath + urlTemplate.expand(xample.request.params);

                        return preq[xample.request.method](xample.request).then(function (res) {
                            if (res.headers && res.headers.date) {
                                delete res.headers.date;
                            }
                            deepEqual(res, xample.response);
                        });
                    });
                }
            };
            return test;
        };
    }

    function createTestsFromOperation(basePath, method, uri, operation) {
        var tests = [];
        var xamples = operation['x-amples'];
        if (xamples) {
            tests = tests.concat(xamples.map(createTestFromXample(basePath, method, uri)));
        }
        return tests;
    }

    function createTestsFromSpec(spec) {
        var createTestsFromPath = function (uri, path) {
            var tests = [];
            for (var method in path) {
                var operation = path[method];
                tests = tests.concat(createTestsFromOperation(spec.basePath, method, uri, operation));
            }
            return tests;
        };
        var tests = [];
        return flatMap(createTestsFromPath, spec.paths);
    }

    var specFragments = [];
    var url = 'http://wikimedia.github.io/restbase/v1/swagger.yaml';
    http.get(url, function (response) {
            response.setEncoding('utf8');
            response.on('data', function (data) { specFragments.push(data); });
            response.on('error', console.error);
            response.on('end', function () {
                describe('swagger.yaml', function() {
                    var spec = yaml.safeLoad(specFragments.join(''));
                    var tests = createTestsFromSpec(spec);
                    tests.map(function (test) {
                        it(test.desc, test.body);
                    });
                });
            });
     });

});
