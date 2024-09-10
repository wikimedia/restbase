'use strict';

// mocha defines to avoid JSHint breakage
/* global it, before */

const parallel = require('mocha.parallel');
const assert = require('../utils/assert.js');
const Server = require('../utils/server.js');
const preq   = require('preq');
const Ajv = require('ajv');
const P = require('bluebird');
const OpenAPISchemaValidator = require('openapi-schema-validator').default;
const validator = new OpenAPISchemaValidator({ version: 3 });

parallel('Responses should conform to the provided JSON schema of the response', () => {
    const ajv = new Ajv({});
    const server = new Server();
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

    before(
        () => server.start()
        .then(() => P.map([
                server.config.defaultDomain,
                'commons.wikimedia.beta.wmflabs.org',
                'wikidata.beta.wmflabs.org'
            ],
            (domain) =>
                preq.get({uri: `${server.config.baseURL(domain)}/?spec`})
                .then((res) => {
                    Object.keys(res.body.components.schemas).forEach((defName) => {
                        try {
                            ajv.addSchema(
                                res.body.components.schemas[defName],
                                `#/components/schemas/${defName}`);
                        } catch(e) {
                            // ignore
                        }
                    });
                })
        ))
    );
    after(() => server.stop());

    it('should expose valid OpenAPI spec', () => {
        return preq.get({ uri: `${server.config.baseURL()}/?spec` })
            .then((res) =>  {
                assert.deepEqual({errors: []}, validator.validate(res.body), 'Spec must have no validation errors');
            });
    });

    [
        {
            path: '/page/summary',
            params: 'Earth',
            schema: 'summary'
        },
        {
            path: '/page/related',
            params: 'San_Francisco',
            schema: 'related'
        },
        {
            path: '/page/media-list',
            params: 'San_Francisco',
            schema: 'media_list'
        },
        /* no recommendation-api in beta {
            domain: 'commons.wikimedia.beta.wmflabs.org',
            path: '/data/recommendation/caption/addition/en',
            schema: 'caption_recommendation_result'
        },
        {
            domain: 'commons.wikimedia.beta.wmflabs.org',
            path: '/data/recommendation/caption/translation/from/en/to/ru',
            schema: 'caption_recommendation_result'
        },
        {
            domain: 'wikidata.beta.wmflabs.org',
            path: '/data/recommendation/description/addition/ru',
            schema: 'description_recommendation_result'
        },
        {
            domain: 'wikidata.beta.wmflabs.org',
            path: '/data/recommendation/description/translation/from/en/to/ru',
            schema: 'description_recommendation_result'
        }, */
    ].forEach((testSpec) => {
        let name = `${testSpec.path} should conform schema`;
        if (testSpec.domain) {
            name += `, ${testSpec.domain}`;
        }
        it(name, () => {
            let path = `${server.config.baseURL(testSpec.domain)}${testSpec.path}`;
            if (testSpec.params) {
                path += `/${testSpec.params}`;
            }
            return preq.get({ uri: path })
            .then((res) => {
                if (!ajv.validate(`#/components/schemas/${testSpec.schema}`, res.body)) {
                    throw new assert.AssertionError({
                        message: ajv.errorsText()
                    });
                }
            });
        });
    });
});

