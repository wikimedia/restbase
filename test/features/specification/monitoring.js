'use strict';

const parallel = require('mocha.parallel');
const preq     = require('preq');
const assert   = require('../../utils/assert.js');
const Server   = require('../../utils/server.js');
const URI      = require('hyperswitch').URI;
const P        = require('bluebird');

function constructTestCase(title, path, method, request, response) {
    return {
        title,
        request: {
            uri: path,
            method,
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

function constructTests(spec, options, server) {
    const paths = spec.paths;
    const ret = [];
    Object.keys(paths).forEach((pathStr) => {
        if (!pathStr) { return; }
        Object.keys(paths[pathStr]).filter((method) => {
            return paths[pathStr][method]['x-monitor'];
        })
        .forEach((method) => {
            const p = paths[pathStr][method];
            const uri = new URI(`${server.config.hostPort}/{domain}/v1${pathStr}`, {}, true);
            if (!p['x-amples']) {
                throw new Error(`${'Method without examples should declare x-monitor: false.'
                    + ' Path: '}${pathStr} Method: ${method}`);
            }
            p['x-amples'].forEach((ex) => {
                ex.request = ex.request || {};
                ex.request.params = ex.request.params || {};
                ex.request.params.domain = ex.request.params.domain || options.domain;
                if (ex.request.params.domain !== options.domain) {
                    return;
                }

                ret.push(constructTestCase(
                    ex.title,
                    uri.toString({
                        params: ex.request.params,
                        format: 'simplePattern'
                    }),
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
    if (expected === null || expected === undefined) { expected = ''; }
    if (result === null || result === undefined) { result = ''; }
    if (expected.length > 1 && expected[0] === '/' && expected[expected.length - 1] === '/') {
        if ((new RegExp(expected.slice(1, -1))).test(result)) {
            return true;
        }
    } else if (expected.length === 0 && result.length === 0) {
        return true;
    } else if (result === expected || result.indexOf(expected) === 0) {
        return true;
    }
    assert.deepEqual(result, expected, errMsg);
    return true;
}


function validateTestResponse(testCase, res) {
    const expRes = testCase.response;
    assert.deepEqual(res.status, expRes.status);
    Object.keys(expRes.headers).forEach((key) => {
        const val = expRes.headers[key];
        assert.deepEqual(res.headers.hasOwnProperty(key), true, `Header ${key} not found in response!`);
        cmp(res.headers[key], val, `${key} header mismatch!`);
    });
    validateBody(res.body || '', expRes.body);
}

function validateArray(val, resVal, key) {
    assert.deepEqual(Array.isArray(resVal), true, `Body field ${key} is not an array!`);
    let arrVal;
    if (val.length === 1) {
        // special case: we have specified only one item in the expected body,
        // but what we really want is to check all of the returned items so
        // fill the expected array with as many items as the returned one
        if (resVal.length < 1) {
            throw new assert.AssertionError({
                message: `Expected more then one element in the field: ${key}`
            });
        }
        arrVal = [];
        while (arrVal.length < resVal.length) {
            arrVal.push(val[0]);
        }
    } else {
        arrVal = val;
    }
    assert.deepEqual(arrVal.length, resVal.length,
        `Different size of array for field ${key}, expected ${arrVal.length
        } actual ${resVal.length}`);
    arrVal.forEach((item, index) => {
        validateBody(resVal[index], item);
    });
}

function validateBody(resBody, expBody) {
    if (!expBody) {
        return true;
    }
    if (Buffer.isBuffer(resBody)) { resBody = resBody.toString(); }
    if (expBody.constructor !== resBody.constructor) {
        if (expBody.constructor === String) {
            resBody = JSON.stringify(resBody);
        } else {
            resBody = JSON.parse(resBody);
        }
    }
    if (expBody.constructor === Object) {
        Object.keys(expBody).forEach((key) => {
            const val = expBody[key];
            assert.deepEqual(resBody.hasOwnProperty(key), true, `Body field ${key} not found in response!`);
            if (val.constructor === Object) {
                validateBody(resBody[key], val);
            } else if (val.constructor === Array) {
                validateArray(val, resBody[key], key);
            } else {
                cmp(resBody[key], val, `${key} body field mismatch!`);
            }
        });
    } else if (Array.isArray(expBody)) {
        validateArray(expBody, resBody, 'body');
    } else {
        cmp(resBody, expBody, 'Body mismatch!');
    }
    return true;
}

describe('Monitoring tests', function() {
    this.timeout(20000);
    const server = new Server();
    before(() => server.start());
    after(() => server.stop());

    it('should get the spec', () => {
        return P.each([{
            domain: 'en.wikipedia.org',
            specURI: `${server.config.baseURL()}/?spec`
        },
        {
            domain: 'wikimedia.org',
            specURI: `${server.config.baseURL('wikimedia.org')}/?spec`
        },
        {
            domain: 'en.wiktionary.org',
            specURI: `${server.config.baseURL('en.wiktionary.org')}/?spec`
        }],
        (options) => {
            return preq.get(options.specURI)
            .then((res) => {
                assert.deepEqual(res.status, 200);
                assert.contentType(res, 'application/json');
                assert.notDeepEqual(res.body, undefined, 'No body received!');
                return res.body;
            })
            .then((spec) => {
                const defineTests = () => {
                    before(() => server.start());
                    after(() => server.stop());
                    constructTests(spec, options, server).forEach((testCase) => {
                        it(testCase.title, () => {
                            const missingParam = /\/{(.+)}/.exec(testCase.request.uri);
                            if (missingParam) {
                                throw new assert.AssertionError({
                                    message: `Incorrect test spec, missing '${missingParam[1]}'`
                                });
                            }
                            return preq(testCase.request)
                            .then((res) => {
                                validateTestResponse(testCase, res);
                            }, (err) => {
                                validateTestResponse(testCase, err);
                            });
                        });
                    });
                };
                parallel(`Monitoring routes, ${options.domain} domain, new content`, defineTests);
                parallel(`Monitoring routes, ${options.domain} domain, from storage`, defineTests);
            });
        });
    });
});

