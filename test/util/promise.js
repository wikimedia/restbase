'use strict';

function curry(f, args) {
    if (!args || !args.length) {
        args = [];
    }
    return function(x) {
        args.push(x);
        if (f.length === args.length) {
            return f.apply(null, args);
        } else {
            return curry(f, args);
        }
    };
}

// The collect() function takes an array of promises and a callback. It passes
// the result of each promise (in order) as an argument to the callback. It
// returns a single promise that yields the result of the callback.
//
// Example:
//
// var p = collect([
//     Promise.resolve(2),
//     Promise.resolve(20),
//     Promise.resolve(1)
// ], function (x, y, z) {
//     return x * (y + z);
// });
//
// p is congruent to Promise.resolve(2 * (20 + 1)), or Promise.resolve(42)
//
function collect(promises, callback) {
    var f = curry(callback);
    var p = promises.reduce(function (p1, p2) {
        return p1.then(function (r1) {
            f = f(r1);
            return p2;
        });
    });
    return p.then(function (r) { return f(r); });
}

module.exports.collect = collect;
