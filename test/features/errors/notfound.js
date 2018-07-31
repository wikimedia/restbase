'use strict';

const parallel = require('mocha.parallel');
const assert   = require('../../utils/assert.js');
const preq     = require('preq');
const server   = require('../../utils/server.js');

parallel('404 handling', function() {

    this.timeout(20000);

    before(() => { return server.start(); });

    it('should return a proper 404 when trying to retrieve a non-existing domain', () => {
        return preq.get({
            uri: `${server.config.hostPort}/v1/foobar.com`
        })
        .catch((e) => {
            assert.deepEqual(e.status, 404);
            assert.contentType(e, 'application/problem+json');
        });
    });
    it('should return a proper 404 when trying to list a non-existing domain', () => {
        return preq.get({
            uri: `${server.config.hostPort}/v1/foobar.com/`
        })
        .catch((e) => {
            assert.deepEqual(e.status, 404);
            assert.contentType(e, 'application/problem+json');
        });
    });
    it('should return a proper 404 when accessing an unknown bucket', () => {
        return preq.get({
            uri: `${server.config.baseURL}/some_nonexisting_bucket`
        })
        .catch((e) => {
            assert.deepEqual(e.status, 404);
            assert.contentType(e, 'application/problem+json');
        });
    });
    it('should return a proper 404 when trying to list an unknown bucket', () => {
        return preq.get({
            uri: `${server.config.baseURL}/some_nonexisting_bucket/`
        })
        .catch((e) => {
            assert.deepEqual(e.status, 404);
            assert.contentType(e, 'application/problem+json');
        });
    });
    it('should return a proper 404 when accessing an item in an unknown bucket', () => {
        return preq.get({
            uri: `${server.config.baseURL}/some_nonexisting_bucket/item`
        })
        .catch((e) => {
            assert.deepEqual(e.status, 404);
            assert.contentType(e, 'application/problem+json');
        });
    });
    it('should return a proper 404 for the latest revision of a missing page', () => {
        return preq.get({
            uri: `${server.config.bucketURL}/ThisIsProblablyNotARealPateTitle/html`
        })
        .catch((e) => {
            assert.deepEqual(e.status, 404);
            assert.contentType(e, 'application/problem+json');
        });
    });
    it('should return 404 on deleted revision', () => {
        return preq.get({
            uri: `${server.config.bucketURL}/revision/668588412`
        })
        .then(() => {
            throw new Error('404 should be returned');
        })
        .catch((e) => {
            assert.deepEqual(e.status, 404);
            assert.contentType(e, 'application/problem+json');
        });
    });
});
