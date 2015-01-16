'use strict';

// mocha defines to avoid JSHint breakage
/* global describe, it, before, beforeEach, after, afterEach */

var assert = require('../../utils/assert.js');
var preq = require('preq');
var request_parser = require('../../../lib/proxyHandler.js');

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

    describe('request templating handler', function() {
        
        it('should create code out of template', function() {
        	var assembler = new request_parser()._assemble;
        	console.log(assembler);
            var a = assembler("$request");
            console.log(a);
            a = assembler({uri:'/foo/bar'});
            console.log(a);
        });
        
    });

    
};
