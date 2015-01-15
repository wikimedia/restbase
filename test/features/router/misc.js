'use strict';

// mocha defines to avoid JSHint breakage
/* global describe, it, before, beforeEach, after, afterEach */

var assert = require('../../utils/assert.js');
var preq = require('preq');

module.exports = function (config) {
    
    describe('router - misc', function() {
        
        it('should deny access to /{domain}/sys', function() {
            return preq.get({
                uri: config.hostPort + '/en.wikipedia.org/sys/table'
            }).catch(function(err) {
                assert.deepEqual(err.status, 403);
            });
        });
        
    });
    
};
