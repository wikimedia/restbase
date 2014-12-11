'use strict';

var assert = require('assert');

function deepEqual (result, expected) {
    try {
        assert.deepEqual(result, expected);
    } catch (e) {
        console.log('Expected:\n' + JSON.stringify(expected,null,2));
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

module.exports.fails = fails;
module.exports.deepEqual = deepEqual;
