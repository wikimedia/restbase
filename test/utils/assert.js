'use strict';

const assert = require('assert');
const mwUtil = require('../../lib/mwUtil');

/**
 * Asserts whether content type was as expected
 */
function contentType(res, expected) {
    const actual = res.headers['content-type'];
    if (/^\/.+\/$/.test(expected)) {
        const expectedRegex = mwUtil.constructRegex([ expected ]);
        assert.ok(expectedRegex.test(actual), `Expected content type should match ${expected}`);
    } else {
        deepEqual(actual, expected, `Expected content-type to be ${expected} , but was ${actual}`);
    }
}

/**
 * Asserts whether all requests in the given
 * slice were routed to local recipients
 */
function localRequests(slice, expected) {
    var hasRec = false;
    var localReqs = !slice.get().some(function(line) {
        var entry = JSON.parse(line);
        if (!entry.req) {
            return false;
        }
        hasRec = true;
        // if the URI starts with a slash,
        // it's a local request
        return !/^\//.test(entry.req.uri);
    });
    if (!hasRec) {
        // there were no records in the slice, so
        // we cannot really decide what that means
        return;
    }
    deepEqual(
        localReqs,
        expected,
        expected ?
          'Should have made a local request' :
          'Should not have made a local request'
    );
}

/**
 * Asserts whether some requests in the given
 * slice were made to remote entities
 */
function remoteRequests(slice, expected) {
    var hasRec = false;
    var remoteReqs = slice.get().some(function(line) {
        var entry = JSON.parse(line);
        if (!entry.req) {
            return false;
        }
        hasRec = true;
        return entry.req && /^https?/.test(entry.req.uri);
    });
    if (!hasRec) {
        // there were no records in the slice, so
        // we cannot really decide what that means
        return;
    }
    deepEqual(
        remoteReqs,
        expected,
        expected ?
          'Should have made a remote request' :
          'Should not have made a remote request'
    );
}

/**
 * Finds the first request to parsoid
 */
function findParsoidRequest(slice) {
    var logEntry = slice.get().find(function(line) {
        var entry = JSON.parse(line);
        return entry.req && /^https?:\/\/parsoid/.test(entry.req.uri);
    });
    return JSON.parse(logEntry).req;
}

function isDeepEqual(result, expected, message) {
    try {
        if (typeof expected === 'string') {
            assert.ok(result === expected || (new RegExp('^' + expected + '$').test(result)), message);
        } else {
            assert.deepEqual(result, expected, message);
        }
        return true;
    } catch (e) {
        return false;
    }
}

function deepEqual(result, expected, message) {
    try {
        if (typeof expected === 'string') {
            assert.ok(result === expected || (new RegExp('^' + expected + '$').test(result)));
        } else {
            assert.deepEqual(result, expected, message);
        }
    } catch (e) {
        console.log('Expected:\n' + JSON.stringify(expected,null,2));
        console.log('Result:\n' + JSON.stringify(result,null,2));
        throw e;
    }
}

function isSuperset(parent, child) {
    var result = true;
    if (child instanceof Object) {
        for (var k in child) {
            isSuperset(parent[k], child[k]);
        }
    } else if (child instanceof Array) {
        for (var i = 0; i < child.length; i++) {
            isSuperset(parent[i], child[i]);
        }
    } else {
        deepEqual(parent, child);
    }
}

function notDeepEqual(result, expected, message) {
    try {
        assert.notDeepEqual(result, expected, message);
    } catch (e) {
        console.log('Not expected:\n' + JSON.stringify(expected,null,2));
        console.log('Result:\n' + JSON.stringify(result,null,2));
        throw e;
    }
}

function fails(promise, onRejected) {
    var failed = false;
    function trackFailure(e) {
        failed = true;
        return onRejected(e);
    }
    function check() {
        if (!failed) {
            throw new Error('expected error was not thrown');
        }
    }
    return promise.catch(trackFailure).then(check);
}

function checkString(result, expected, message) {
    if (expected.constructor === RegExp) {
        assert.ok(expected.test(result), '' + expected + '.test(' + result + ') fails');
    } else {
        var de = assert.deepStrictEqual || assert.deepEqual;
        de(result, expected, expected + ' !== ' + result);
    }
}

/**
 * Validates the comma-separated list of header names.
 * @param {string} headerList - the list of header names
 * @param {Object} options - the validator options
 * @param {array=} options.require - list of header names required to be present. Example: [ 'Accept', 'Accept-Encoding']. Case-insensitive.
 * @param {array=} options.disallow - list of header names NOT allowed. Example: [ 'Accept-Language' ]. Case-insensitive.
 * @param {boolean} [options.allowDuplicates] - whether duplicated entries could be present in the `headerList`. Default: false
 **/
function validateListHeader(headerList, options) {
    if (!headerList) {
        throw new assert.AssertionError({
            message: `Can not validate with empty headers`
        });
    }
    if (headerList === '') {
        throw new assert.AssertionError({
            message: `Header list should not be an empty string ('')`
        });
    }
    const headerArray = headerList.split(',').map(header => header.trim().toLowerCase());
    if (options.require) {
        options.require.forEach(header => {
            if (!headerArray.includes(header.trim().toLowerCase())) {
                throw new assert.AssertionError({
                    message: `Header does not contain ${header}`
                });
            }
        });
    }

    if (options.disallow) {
        options.disallow.forEach(header => {
            if (headerArray.includes(header.trim().toLowerCase())) {
                throw new assert.AssertionError({
                    message: `Header contains ${header} while it must not`
                });
            }
        });
    }

    if (options.allowDuplicates === false || !options.allowDuplicates) {
        const filterDuplicates = headerArray.filter((header, index) => headerArray.indexOf(header) === index);
        if (filterDuplicates.length !== headerArray.length) {
            throw new assert.AssertionError({
                message: `${headerList} contains duplicates`
            });
        }
    }
}

module.exports.ok             = assert.ok;
module.exports.AssertionError = assert.AssertionError;
module.exports.fails          = fails;
module.exports.deepEqual      = deepEqual;
module.exports.isDeepEqual    = isDeepEqual;
module.exports.notDeepEqual   = notDeepEqual;
module.exports.isSuperset     = isSuperset;
module.exports.contentType    = contentType;
module.exports.localRequests  = localRequests;
module.exports.remoteRequests = remoteRequests;
module.exports.findParsoidRequest = findParsoidRequest;
module.exports.checkString    = checkString;
module.exports.validateListHeader = validateListHeader;
