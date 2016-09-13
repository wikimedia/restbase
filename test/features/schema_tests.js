"use strict";

// mocha defines to avoid JSHint breakage
/* global describe, it, before, beforeEach, after, afterEach */

var assert = require('../utils/assert.js');
var server = require('../utils/server.js');
var preq   = require('preq');
var Ajv = require('ajv');

describe('Responses should conform to the provided JSON schema of the responce', function() {
    var ajv = new Ajv({});

    before(function() {
        return server.start()
        .then(function() { return preq.get({ uri: server.config.baseURL + '/?spec' }); })
        .then(function(res) {
            Object.keys(res.body.definitions).forEach(function(defName) {
                ajv.addSchema(res.body.definitions[defName], '#/definitions/' + defName);
            });
        });
    });

    it('/feed/featured should conform schema', function() {
        return preq.get({ uri: server.config.baseURL + '/feed/featured/2016/09/08' })
        .then(function(res) {
            if (!ajv.validate('#/definitions/feed', res.body)) {
                throw new assert.AssertionError({
                    message: ajv.errorsText()
                });
            }
        });
    });

    it('/feed/featured should conform schema, ruwiki', function() {
        return preq.get({ uri: server.config.hostPort + '/ru.wikipedia.org/v1/feed/featured/2016/09/08' })
        .then(function(res) {
            if (!ajv.validate('#/definitions/feed', res.body)) {
                throw new assert.AssertionError({
                    message: ajv.errorsText()
                });
            }
        });
    });


    it('/page/summary/{title} should conform schema', function() {
        return preq.get({ uri: server.config.baseURL + '/page/summary/Tank' })
        .then(function(res) {
            if (!ajv.validate('#/definitions/summary', res.body)) {
                throw new assert.AssertionError({
                    message: ajv.errorsText()
                });
            }
        });
    });
});
