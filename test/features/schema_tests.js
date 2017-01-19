"use strict";

// mocha defines to avoid JSHint breakage
/* global describe, it, before, beforeEach, after, afterEach */

const parallel = require('mocha.parallel');
var assert = require('../utils/assert.js');
var server = require('../utils/server.js');
var preq   = require('preq');
var Ajv = require('ajv');

parallel('Responses should conform to the provided JSON schema of the response', function() {
    var ajv = new Ajv({});

    function getToday() {
        function zeroPad(num) {
            if (num < 10) {
                return `0${num}`;
            }
            return `${num}`;
        }
        const now = new Date();
        return `${now.getUTCFullYear()}/${zeroPad(now.getUTCMonth() + 1)}/${zeroPad(now.getUTCDate())}`;
    }

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
        return preq.get({ uri: `${server.config.baseURL}/feed/featured/${getToday()}` })
        .then(function(res) {
            if (!ajv.validate('#/definitions/feed', res.body)) {
                throw new assert.AssertionError({
                    message: ajv.errorsText()
                });
            }
        });
    });

    it('/feed/featured should conform schema, ruwiki', function() {
        return preq.get({ uri: `${server.config.hostPort}/ru.wikipedia.org/v1/feed/featured/${getToday()}` })
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

    it('/feed/announcements should conform schema', function() {
        return preq.get({ uri: server.config.baseURL + '/feed/announcements' })
        .then(function(res) {
            if (!ajv.validate('#/definitions/announcementsResponse', res.body)) {
                throw new assert.AssertionError({
                    message: ajv.errorsText()
                });
            }
        });
    });


    it('/page/related should conform schema', function() {
        return preq.get({ uri: server.config.bucketURL + '/related/Tank' })
        .then(function(res) {
            if (!ajv.validate('#/definitions/related', res.body)) {
                throw new assert.AssertionError({
                    message: ajv.errorsText()
                });
            }
        });
    });
});
