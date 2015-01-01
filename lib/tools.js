'use strict';

/*
 * A bunch of handy functions that should probably live in a module somewhere.
 */

function filterByKey(object, filter) {
    var filtered = {};
    Object.keys(object).forEach(function (key) {
        if (filter(key)) {
            filtered[key] = object[key];
        }
    });
    return filtered;
}

function find(xs, predicate) {
    for (var i = 0; i < xs.length; i++) {
        var x = xs[i];
        if (predicate(x)) {
            return i;
        }
    }
    return null;
}

function contains(xs, y) {
    return find(xs, function (x) { return x === y; }) !== null;
}

function filterOutKeys(object, keys) {
    return filterByKey(object, function (key) {
        return !contains(keys, key);
    });
}

module.exports.filterByKey   = filterByKey;
module.exports.find          = find;
module.exports.contains      = contains;
module.exports.filterOutKeys = filterOutKeys;
