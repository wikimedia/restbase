'use strict';

/*
 * A bunch of handy functions that should probably live in a module somewhere.
 */

require('es6-shim');
global.Promise = require('bluebird');

function filterByKey(object, filter) {
    var filtered = {};
    Object.keys(object).forEach(function (key) {
        if (filter(key)) {
            filtered[key] = object[key];
        }
    });
    return filtered;
}

function contains(y, xs) {
    var x = xs.find(function (x) { return x === y; });
    return (x !== undefined);
}

function filterOutKeys(object, keys) {
    return filterByKey(object, function (key) {
        return !contains(key, keys);
    });
}

module.exports.filterByKey   = filterByKey;
module.exports.contains      = contains;
module.exports.filterOutKeys = filterOutKeys;
