'use strict';

var restbase = require('../lib/server.js');
var preq = require('preq');
var assert = require('assert');
var baseURL = 'http://localhost:8888/v1/en.wikipedia.org/test101';

function deepEqual (result, expected) {
    try {
        assert.deepEqual(result, expected);
    } catch (e) {
        console.log('Expected:\n' + JSON.stringify(expected,null,2));
        console.log('Result:\n' + JSON.stringify(result,null,2));
        throw e;
    }
}

describe('Simple API tests', function () {
    before(function() {
        this.timeout(20000);
        return restbase();
    });
    describe('Domain & bucket creation', function() {
        it('should create a domain', function() {
            return preq.put({
                uri: 'http://localhost:8888/v1/en.wikipedia.org',
                headers: { 'content-type': 'application/json' },
                body: {}
            })
            .then(function(res) {
                deepEqual(res.status, 201);
            });
        });
    });
    describe('Bucket creation', function() {
        it('should create a page bucket', function() {
            this.timeout(20000);
            return preq.put({
                uri: baseURL,
                headers: { 'content-type': 'application/json' },
                body: { type: 'pagecontent' }
            })
            .then(function(res) {
                deepEqual(res.status, 201);
            });
        });
        //it('should not accept a new html save without a revision', function() {
        //    return preq.put({
        //        uri: baseURL + '/Foo/html',
        //        headers: { 'content-type': 'text/html' },
        //        body: 'Hello there'
        //    })
        //    .then(function(res) {
        //        deepEqual(res.status, 404);
        //    });
        //});
        it('should transparently create a new HTML revision', function() {
            this.timeout(20000);
            return preq.get({
                uri: baseURL + '/Foobar/html/624484477',
                headers: { 'content-type': 'text/html' },
                body: 'Hello there'
            })
            .then(function(res) {
                deepEqual(res.status, 200);
            });
        });
        it('should return HTML just created', function() {
            return preq.get({
                uri: baseURL + '/Foobar/html/624484477'
            })
            .then(function(res) {
                deepEqual(res.status, 200);
            });
        });
        it('should transparently create data-parsoid, rev 2', function() {
            this.timeout(20000);
            return preq.get({
                uri: baseURL + '/Foobar/html/624165266'
            })
            .then(function(res) {
                deepEqual(res.status, 200);
            });
        });
        it('should return HTML just created, rev 2', function() {
            return preq.get({
                uri: baseURL + '/Foobar/html/624165266'
            })
            .then(function(res) {
                deepEqual(res.status, 200);
                deepEqual(res.headers['content-type'], 'text/html; charset=UTF-8');
            });
        });
        it('should return data-parsoid just created, rev 2', function() {
            return preq.get({
                uri: baseURL + '/Foobar/data-parsoid/624165266'
            })
            .then(function(res) {
                deepEqual(res.status, 200);
                deepEqual(res.headers['content-type'], 'application/json; profile=mediawiki.org/specs/data-parsoid/1.0');
            });
        });
        it('should accept a new html save with a revision', function() {
            return preq.put({
                uri: baseURL + '/Foobar/html/76f22880-362c-11e4-9234-0123456789ab',
                headers: { 'content-type': 'text/html; charset=UTF-8' },
                body: 'Hello there'
            })
            .then(function(res) {
                deepEqual(res.status, 201);
            })
            .catch(function(e) {
                console.dir(e.response);
                throw e;
            });
        });
        it('should return the HTML revision just created', function() {
            return preq.get({
                uri: baseURL + '/Foobar/html/624484477'
            })
            .then(function(res) {
                deepEqual(res.status, 200);
                deepEqual(res.headers['content-type'], 'text/html; charset=UTF-8');
                deepEqual(res.headers.etag, '76f22880-362c-11e4-9234-0123456789ab');
                deepEqual(res.body, 'Hello there');
            });
        });
    });
});
