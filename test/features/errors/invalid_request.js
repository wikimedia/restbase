'use strict';

// mocha defines to avoid JSHint breakage
/* global describe, it, before, beforeEach, after, afterEach */

var assert = require('../../utils/assert.js');
var preq   = require('preq');
var server = require('../../utils/server.js');

describe('400 handling', function() {
    this.timeout(20000);

    before(function () { return server.start(); });

    it('should return a proper 400 for an empty POST', function() {
        return preq.post({
            uri: server.config.hostPort,
            headers: {
                'content-type': 'foo/bar'
            },
        })
        .catch(function(e) {
            assert.deepEqual(e.status, 400);
            assert.contentType(e, 'application/problem+json');
        });
    });

    it('should return a proper 400 for an invalid POST', function() {
        return preq.post({
            uri: server.config.hostPort,
            headers: {
                'content-type': 'foo/bar'
            },
            body: 'baz'
        })
        .catch(function(e) {
            assert.deepEqual(e.status, 400);
            assert.contentType(e, 'application/problem+json');
        });
    });

    it('Should return 400 on invalid JSON sections', function() {
        var pageWithSectionsTitle = 'User:Pchelolo',
            pageWithSectionsRev = 669197670;
        return preq.post({
            uri: server.config.baseURL
                + '/transform/sections/to/wikitext/'
                + pageWithSectionsTitle
                + '/' + pageWithSectionsRev,
            body: {
                sections: '{"mwAQ":"First section replaced" INVALID}'
            }
        })
        .then(function() {
            throw new Error("400 should be returned");
        })
        .catch(function(e) {
            assert.deepEqual(e.status, 400);
            assert.contentType(e, 'application/problem+json');
        });
    });

    it('Should return 400 if non-existent section id provided', function() {
        var pageWithSectionsTitle = 'User:Pchelolo',
            pageWithSectionsRev = 669197670;
        return preq.post({
            uri: server.config.baseURL
                + '/transform/sections/to/wikitext/'
                + pageWithSectionsTitle
                + '/' + pageWithSectionsRev,
            body: {
                sections: '{"INVALID":"First section replaced"}'
            }
        })
        .then(function() {
            throw new Error("400 should be returned");
        })
        .catch(function(e) {
            assert.deepEqual(e.status, 400);
            assert.contentType(e, 'application/problem+json');
        });
    });
});
