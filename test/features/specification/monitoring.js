'use strict';

var preq   = require('preq');
var assert = require('../../utils/assert.js');
var server = require('../../utils/server.js');
var URI    = require('hyperswitch').URI;
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

function constructTests(spec, options) {
    var paths = spec.paths;
    var ret = [];
    Object.keys(paths).forEach(function(pathStr) {
        if (!pathStr) return;
        Object.keys(paths[pathStr]).filter(function(method) {
            return paths[pathStr][method]['x-monitor'];
        })
        .forEach(function(method) {
            var p = paths[pathStr][method];
            var uri = new URI(server.config.hostPort + '/{domain}/v1' + pathStr, {}, true);
            if (!p['x-amples']) {
                throw new Error('Method without examples should declare x-monitor: false.'
                    + ' Path: ' + pathStr + ' Method: ' + method);
            }
            p['x-amples'].forEach(function(ex) {
                ex.request = ex.request || {};
                ex.request.params = ex.request.params || {};
                ex.request.params.domain = ex.request.params.domain || options.domain;
                if (ex.request.params.domain !== options.domain) {
                    return;
                }

                ret.push(constructTestCase(
                    ex.title,
                    uri.toString({params: ex.request.params}),
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
    if(expected === null || expected === undefined) { expected = ''; }
    if(result === null || result === undefined) { result = ''; }
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
                assert.deepEqual(Array.isArray(resBody[key]), true,
                    'Body field ' + key + ' is not an array!');
                var arrVal;
                if(val.length === 1) {
                    // special case: we have specified only one item in the expected body,
                    // but what we really want is to check all of the returned items so
                    // fill the expected array with as many items as the returned one
                    arrVal = [];
                    while(arrVal.length < resBody[key].length) {
                        arrVal.push(val[0]);
                    }
                } else {
                    arrVal = val;
                }
                assert.deepEqual(arrVal.length === resBody[key].length, true,
                    'Different size of array for field ' + key + ', expected ' + arrVal.length +
                    ' actual ' + resBody[key].length);
                arrVal.forEach(function(item, index) {
                    validateBody(resBody[key][index], item);
                });
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
            },
            {
                domain: 'en.wiktionary.org',
                specURI: server.config.hostPort + '/en.wiktionary.org/v1/?spec'
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
                    constructTests(spec, options).forEach(function(testCase) {
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

