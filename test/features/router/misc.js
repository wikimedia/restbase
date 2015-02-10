'use strict';

// mocha defines to avoid JSHint breakage
/* global describe, it, before, beforeEach, after, afterEach */

var assert = require('../../utils/assert.js');
var preq   = require('preq');
var server = require('../../utils/server.js');
var temp_parser = require('../../../lib/reqTemplating.js');

describe('router - misc', function() {
    this.timeout(20000);

    before(function () { return server.start(); });


    it('should deny access to /{domain}/sys', function() {
        return preq.get({
            uri: server.config.hostPort + '/en.wikipedia.org/sys/table'
        }).catch(function(err) {
            assert.deepEqual(err.status, 403);
        });
    });
    
    describe('request templating handler', function() {
        it('should create code out of template', function() {
            // pass a template which uses parent request
            var e = temp_parser("$request");
            assert.deepEqual(e({uri:'/foo/bar'}), {uri:'/foo/bar'})
            
            // pass a template with basic uri
            e = temp_parser({
                uri:'/foobar/bar',
            });
            assert.deepEqual(e({uri:'/foo/bar'}), {});
            
            // pass a template with basic uri and header
            e = temp_parser({
                uri:'/foobar/bar',
                header: '$request.header'
            });
            assert.deepEqual(
                e({ uri: '/foo/bar', header: {'foo': 'foobar'} }), 
                {header: {'foo': 'foobar'}}
            );
        });
    });

});
