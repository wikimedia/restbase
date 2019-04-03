'use strict';

// mocha defines to avoid JSHint breakage
/* global it, before */

const parallel = require('mocha.parallel');
const assert = require('../utils/assert.js');
const Server = require('../utils/server.js');
const preq   = require('preq');
const Ajv = require('ajv');

parallel('Responses should conform to the provided JSON schema of the response', () => {
    const ajv = new Ajv({});
    const server = new Server(`${__dirname}/../../config.example.wikimedia.yaml`);
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

    before(() => server.start()
    .then(() => preq.get({uri: `${server.config.baseURL()}/?spec`}))
    .then((res) => {
        Object.keys(res.body.definitions).forEach((defName) => {
            ajv.addSchema(res.body.definitions[defName], `#/definitions/${defName}`);
        });
    }));
    after(() => server.stop());

    it('should expose valid OpenAPI spec', () => {
        return preq.get({ uri: `${server.config.baseURL()}/?spec` })
            .then((res) =>  {
                return preq.post({uri: `http://online.swagger.io/validator/debug`,
                    body: JSON.stringify(res.body)})
                    .then((res) => {
                        // if valid will return an empty object: {}
                        assert.deepEqual({}, res.body, 'Spec must have no validation errors');
                    })
            });
    });

    it('/feed/featured should conform schema', () => {
        return preq.get({ uri: `${server.config.baseURL()}/feed/featured/${getToday()}` })
        .then((res) => {
            if (!ajv.validate('#/definitions/feed', res.body)) {
                throw new assert.AssertionError({
                    message: ajv.errorsText()
                });
            }
        });
    });

    it('/feed/featured should conform schema, ruwiki', () => {
        return preq.get({ uri: `${server.config.baseURL('ru.wikipedia.org')}/feed/featured/${getToday()}` })
        .then((res) => {
            if (!ajv.validate('#/definitions/feed', res.body)) {
                throw new assert.AssertionError({
                    message: ajv.errorsText()
                });
            }
        });
    });


    it('/page/summary/{title} should conform schema', () => {
        return preq.get({ uri: `${server.config.baseURL()}/page/summary/Tank` })
        .then((res) => {
            if (!ajv.validate('#/definitions/summary', res.body)) {
                throw new assert.AssertionError({
                    message: ajv.errorsText()
                });
            }
        });
    });

    it('/feed/announcements should conform schema', () => {
        return preq.get({ uri: `${server.config.baseURL()}/feed/announcements` })
        .then((res) => {
            if (!ajv.validate('#/definitions/announcementsResponse', res.body)) {
                throw new assert.AssertionError({
                    message: ajv.errorsText()
                });
            }
        });
    });

    it('/feed/onthisday should conform schema', () => {
        return preq.get({ uri: `${server.config.baseURL()}/feed/onthisday/all/01/03` })
        .then((res) => {
            if (!ajv.validate('#/definitions/onthisdayResponse', res.body)) {
                throw new assert.AssertionError({
                    message: ajv.errorsText()
                });
            }
        });
    });


    it('/page/related should conform schema', () => {
        return preq.get({ uri: `${server.config.bucketURL()}/related/Tank` })
        .then((res) => {
            if (!ajv.validate('#/definitions/related', res.body)) {
                throw new assert.AssertionError({
                    message: ajv.errorsText()
                });
            }
        });
    });
});

