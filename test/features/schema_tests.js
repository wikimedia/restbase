'use strict';

// mocha defines to avoid JSHint breakage
/* global it, before */

const parallel = require('mocha.parallel');
const assert = require('../utils/assert.js');
const Server = require('../utils/server.js');
const preq   = require('preq');
const Ajv = require('ajv');
const OpenAPISchemaValidator = require('openapi-schema-validator').default;
const validator = new OpenAPISchemaValidator({ version: 3 });

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
        Object.keys(res.body.components.schemas).forEach((defName) => {
            ajv.addSchema(res.body.components.schemas[defName], `#/components/schemas/${defName}`);
        });
    }));
    after(() => server.stop());

    it('should expose valid OpenAPI spec', () => {
        return preq.get({ uri: `${server.config.baseURL()}/?spec` })
            .then((res) =>  {
                assert.deepEqual({errors: []}, validator.validate(res.body), 'Spec must have no validation errors');
            });
    });

    it('/feed/featured should conform schema', () => {
        return preq.get({ uri: `${server.config.baseURL()}/feed/featured/${getToday()}` })
        .then((res) => {
            if (!ajv.validate('#/components/schemas/feed', res.body)) {
                throw new assert.AssertionError({
                    message: ajv.errorsText()
                });
            }
        });
    });

    it('/feed/featured should conform schema, ruwiki', () => {
        return preq.get({ uri: `${server.config.baseURL('ru.wikipedia.org')}/feed/featured/${getToday()}` })
        .then((res) => {
            if (!ajv.validate('#/components/schemas/feed', res.body)) {
                throw new assert.AssertionError({
                    message: ajv.errorsText()
                });
            }
        });
    });


    it('/page/summary/{title} should conform schema', () => {
        return preq.get({ uri: `${server.config.baseURL()}/page/summary/Tank` })
        .then((res) => {
            if (!ajv.validate('#/components/schemas/summary', res.body)) {
                throw new assert.AssertionError({
                    message: ajv.errorsText()
                });
            }
        });
    });

    it('/feed/announcements should conform schema', () => {
        return preq.get({ uri: `${server.config.baseURL()}/feed/announcements` })
        .then((res) => {
            if (!ajv.validate('#/components/schemas/announcementsResponse', res.body)) {
                throw new assert.AssertionError({
                    message: ajv.errorsText()
                });
            }
        });
    });

    it('/feed/onthisday should conform schema', () => {
        return preq.get({ uri: `${server.config.baseURL()}/feed/onthisday/all/01/03` })
        .then((res) => {
            if (!ajv.validate('#/components/schemas/onthisdayResponse', res.body)) {
                throw new assert.AssertionError({
                    message: ajv.errorsText()
                });
            }
        });
    });


    it('/page/related should conform schema', () => {
        return preq.get({ uri: `${server.config.bucketURL()}/related/Tank` })
        .then((res) => {
            if (!ajv.validate('#/components/schemas/related', res.body)) {
                throw new assert.AssertionError({
                    message: ajv.errorsText()
                });
            }
        });
    });

    it('/data/recommendation/article/creation/translation/{from_lang} should conform to schema', () => {
        return preq.get({ uri: `${server.config.baseURL()}/data/recommendation/article/creation/translation/uz?count=5` })
        .then((res) => {
            if (!ajv.validate('#/components/schemas/recommendation_result', res.body)) {
                throw new assert.AssertionError({
                    message: ajv.errorsText()
                });
            }
        });
    });

    it('/data/recommendation/article/creation/translation/{from_lang}/{seed_article} should conform to schema', () => {
        return preq.get({ uri: `${server.config.baseURL()}/data/recommendation/article/creation/translation/uz/Kitob?count=5` })
        .then((res) => {
            if (!ajv.validate('#/components/schemas/recommendation_result', res.body)) {
                throw new assert.AssertionError({
                    message: ajv.errorsText()
                });
            }
        });
    });

    it('/data/recommendation/article/creation/morelike/{seed_article} should conform to schema', () => {
        return preq.get({ uri: `${server.config.baseURL()}/data/recommendation/article/creation/morelike/Book` })
        .then((res) => {
            if (!ajv.validate('#/components/schemas/morelike_result', res.body)) {
                throw new assert.AssertionError({
                    message: ajv.errorsText()
                });
            }
        });
    });
});

