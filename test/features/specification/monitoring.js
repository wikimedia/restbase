'use strict';

var preq   = require('preq');
var assert = require('../../utils/assert.js');
var server = require('../../utils/server.js');
var URI    = require('swagger-router').URI;

function constructTestCase(title, path, method, request, response) {
    return {
        title: title,
        request: {
            uri: server.config.baseURL + '/' + (path[0] === '/' ? path.substr(1) : path),
            method: method,
            headers: request.headers || {},
            query: request.query,
            body: request.body,
            followRedirect: false
        },
        response: {
            status: response.status || 200,
            headers: response.headers || {},
            body: response.body
        }
    };
}

function constructTests(paths, defParams) {
    var ret = [];
    Object.keys(paths).forEach(function(pathStr) {
        Object.keys(paths[pathStr]).filter(function(method) {
            return !!paths[pathStr][method]['x-amples'];
        })
        .forEach(function(method) {
            var p = paths[pathStr][method];
            var uri = new URI(pathStr, {}, true);
            p['x-amples'].forEach(function(ex) {
                ex.request = ex.request || {};
                ret.push(constructTestCase(
                    ex.title,
                    uri.toString({params: Object.assign({}, defParams, ex.request.params || {})}),
                    method,
                    ex.request,
                    ex.response || {},
                    defParams
                ));
            });
        });
    });
    return ret;
}


function cmp(result, expected, errMsg) {
    expected = expected || '';
    result = result || '';
    if(expected.length > 1 && expected[0] === '/' && expected[expected.length - 1] === '/') {
        if((new RegExp(expected.slice(1, -1))).test(result)) {
            return true;
        }
    } else if(expected.length === 0 && result.length === 0) {
        return true;
    } else if(result === expected || result.indexOf(expected) === 0) {
        return true;
    }
    assert.deepEqual(result, expected, errMsg);
    return true;
}


function validateTestResponse(testCase, res) {
    var expRes = testCase.response;
    assert.deepEqual(res.status, expRes.status);
    Object.keys(expRes.headers).forEach(function(key) {
        var val = expRes.headers[key];
        assert.deepEqual(res.headers.hasOwnProperty(key), true, 'Header ' + key + ' not found in response!');
        cmp(res.headers[key], val, key + ' header mismatch!');
    });
    // check the body
    if(!expRes.body) {
        return true;
    }
    res.body = res.body || '';
    if(Buffer.isBuffer(res.body)) { res.body = res.body.toString(); }
    if(expRes.body.constructor !== res.body.constructor) {
        if(expRes.body.constructor === String) {
            res.body = JSON.stringify(res.body);
        } else {
            res.body = JSON.parse(res.body);
        }
    }
    if(expRes.body.constructor === Object) {
        Object.keys(expRes.body).forEach(function(key) {
            var val = expRes.body[key];
            assert.deepEqual(res.body.hasOwnProperty(key), true, 'Body field ' + key + ' not found in response!');
            cmp(res.body[key], val, key + ' body field mismatch!');
        });
    } else {
        cmp(res.body, expRes.body, 'Body mismatch!');
    }

    return true;

}

describe('Monitoring endpoints', function() {
    this.timeout(20000);

    var spec;
    before(function () {
        return server.start();
    });

    it('should get the spec', function() {
        return preq.get(server.config.baseURL + '/?spec')
        .then(function(res) {
            assert.deepEqual(res.status, 200);
            assert.contentType(res, 'application/json');
            assert.notDeepEqual(res.body, undefined, 'No body received!');
            return res.body;
        }).then(function(spec) {
            describe('monitoring routes', function() {
                constructTests(spec.paths, spec['x-default-params'] || {}).forEach(function(testCase) {
                    it(testCase.title, function() {
                        return preq(testCase.request)
                        .then(function(res) {
                            validateTestResponse(testCase, res);
                        }, function(err) {
                            validateTestResponse(testCase, err);
                        });
                    });
                });
            });
        });
    });
});

