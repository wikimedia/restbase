'use strict';

var preq   = require('preq');
var assert = require('../../utils/assert.js');
var server = require('../../utils/server.js');
var URI    = require('swagger-router').URI;
var P      = require('bluebird');

function constructTestCase(title, path, method, request, response) {
    return {
        title: title,
        request: {
            uri: path,
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

function constructTests(spec, defParams) {
    var paths = spec.paths;
    if (spec['x-default-params']) {
        Object.keys(spec['x-default-params']).forEach(function(paramName) {
           if (!defParams[paramName]) {
               defParams[paramName] = spec['x-default-params'][paramName];
           }
        });
    }
    var ret = [];
    Object.keys(paths).forEach(function(pathStr) {
        if (!pathStr) return;
        Object.keys(paths[pathStr]).filter(function(method) {
            if (paths[pathStr][method]['x-monitor'] === undefined) {
                throw new Error('x-monitor not specified for endpoint.'
                    + ' Path: ' + pathStr + ' Method: ' + method)
            }
            return paths[pathStr][method]['x-monitor'];
        })
        .forEach(function(method) {
            var p = paths[pathStr][method];
            var uri = new URI(server.config.hostPort + '/{domain}/v1' + pathStr, {}, true);
            if (!p['x-amples']) {
                throw new Error('Method without examples should decalre x-monitor: false.'
                    + ' Path: ' + pathStr + ' Method: ' + method);
            }
            p['x-amples'].forEach(function(ex) {
                ex.request = ex.request || {};
                ret.push(constructTestCase(
                    ex.title,
                    uri.toString({params: Object.assign({}, defParams, ex.request.params || {})}),
                    method,
                    ex.request,
                    ex.response || {}
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
    validateBody(res.body || '', expRes.body);
}

function validateBody(resBody, expBody) {
    if(!expBody) {
        return true;
    }
    if(Buffer.isBuffer(resBody)) { resBody = resBody.toString(); }
    if(expBody.constructor !== resBody.constructor) {
        if(expBody.constructor === String) {
            resBody = JSON.stringify(resBody);
        } else {
            resBody = JSON.parse(resBody);
        }
    }
    if(expBody.constructor === Object) {
        Object.keys(expBody).forEach(function(key) {
            var val = expBody[key];
            assert.deepEqual(resBody.hasOwnProperty(key), true, 'Body field ' + key + ' not found in response!');
            if (val.constructor === Object) {
                validateBody(resBody[key], val)
            } else if (val.constructor === Array) {
                assert.deepEqual(val.length === resBody[key].length, true,
                    'Different size of array: expected ' + val.length + ' actual ' + resBody[key].length);
                val.forEach(function(item, index) {
                    validateBody(resBody[key][index], item);
                })
            } else {
                cmp(resBody[key], val, key + ' body field mismatch!');
            }
        });
    } else {
        cmp(resBody, expBody.body, 'Body mismatch!');
    }
    return true;
}

describe('Monitoring tests', function() {
    this.timeout(20000);

    var spec;
    before(function () {
        return server.start();
    });

    it('should get the spec', function() {
        return P.each([{
                domain: 'en.wikipedia.org',
                specURI: server.config.baseURL + '/?spec'
            },
            {
                domain: 'wikimedia.org',
                specURI: server.config.globalURL + '/?spec'
            }],
        function(options) {
            return preq.get(options.specURI)
            .then(function(res) {
                assert.deepEqual(res.status, 200);
                assert.contentType(res, 'application/json');
                assert.notDeepEqual(res.body, undefined, 'No body received!');
                return res.body;
            })
            .then(function(spec) {
                describe('Monitoring routes, ' + options.domain + ' domain', function() {
                    var defaults = spec['x-default-params'] || {};
                    if (options.domain === 'en.wikipedia.org') {
                        defaults.domain = 'en.wikipedia.beta.wmflabs.org';
                    } else {
                        defaults.domain = options.domain;
                    }
                    constructTests(spec, defaults).forEach(function(testCase) {
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
});

