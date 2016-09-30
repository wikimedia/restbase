'use strict';


// Run jshint as part of normal testing
require('mocha-jshint')();
// Run jscs as part of normal testing
require('mocha-jscs')();
require('mocha-eslint')([
    'lib',
    'sys',
    'v1'
]);