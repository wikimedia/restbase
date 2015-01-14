'use strict';

var assert = require('assert');

function deepEqual(result, expected) {
    try {
        if (typeof expected === 'string') {
            assert.ok(result === expected || (new RegExp(expected).test(result)));
        } else {
            assert.deepEqual(result, expected);
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

function notDeepEqual(result, expected) {
    try {
        assert.notDeepEqual(result, expected);
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

module.exports.ok           = assert.ok;
module.exports.fails        = fails;
module.exports.deepEqual    = deepEqual;
module.exports.notDeepEqual = notDeepEqual;
module.exports.isSuperset   = isSuperset;
