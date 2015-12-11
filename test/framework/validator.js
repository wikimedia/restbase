"use strict";

// mocha defines to avoid JSHint breakage
/* global describe, it, before, beforeEach, after, afterEach */

var assert = require('./utils/assert.js');
var Validator = require('../../lib/validator');
var HTTPError = require('../../lib/rbUtil').HTTPError;

describe('Validator', function() {

    it('Should validate request for required fields', function() {
        var validator = new Validator([{
            name: 'testParam',
            in: 'formData',
            required: true
        }]);
        try {
            validator.validate({
                body: {
                    otherParam: 'test'
                }
            });
            throw new Error('Error should be thrown');
        } catch(e) {
            assert.deepEqual(e.constructor.name, 'HTTPError');
            assert.deepEqual(e.body.detail, "data.body should have required property 'testParam'");
        }
    });

    it('Should compile validator with no required fields', function() {
        new Validator([{
            name: 'testParam',
            in: 'formData'
        }]);
    });

    it('Should validate integers', function() {
        var validator = new Validator([{
            name: 'testParam',
            in: 'query',
            type: 'integer',
            required: true
        }]);
        try {
            validator.validate({
                query: {
                    testParam: 'not_an_integer'
                }
            });
            throw new Error('Error should be thrown');
        } catch(e) {
            assert.deepEqual(e.constructor.name, 'HTTPError');
            assert.deepEqual(e.body.detail, 'data.query.testParam should be an integer');
        }
    });

    it('Should validate object schemas', function() {
        var validator = new Validator([{
            name: 'testParam',
            in: 'body',
            schema: {
                type: 'object',
                properties: {
                    field1: {
                        type: 'string'
                    },
                    field2: {
                        type: 'string'
                    }
                },
                required: ['field1', 'field2']
            },
            required: true
        }]);
        try {
            validator.validate({
                body: {
                    field1: 'some string'
                }
            });
            throw new Error('Error should be thrown');
        } catch(e) {
            assert.deepEqual(e.constructor.name, 'HTTPError');
            assert.deepEqual(e.body.detail, "data.body should have required property 'field2'");
        }
    });

    it('Should allow floats in number validator', function() {
        var validator = new Validator([
            {
                name: 'testParam1',
                in: 'query',
                type: 'number',
                required: true
            },
            {
                name: 'testParam2',
                in: 'query',
                type: 'number',
                required: true
            }
        ]);
        validator.validate({
            query: {
                testParam1: '27.5',
                testParam2: '27,5'
            }
        });
    });

    it('Should coerce boolean parameters', function() {
        var validator = new Validator([
            { name: 'boolParamTrue', in: 'query', type: 'boolean' },
            { name: 'boolParamTrueUpperCase', in: 'query', type: 'boolean' },
            { name: 'boolParamFalse', in: 'query', type: 'boolean' },
            { name: 'boolParamFalseUpperCase', in: 'query', type: 'boolean' },
            { name: 'boolParam0', in: 'query', type: 'boolean' },
            { name: 'boolParam1', in: 'query', type: 'boolean' },
        ]);
        var req = {
            query: {
                boolParamTrue: 'true',
                boolParamTrueUpperCase: 'True',
                boolParamFalse: 'false',
                boolParamFalseUpperCase: 'False',
                boolParam0: '0',
                boolParam1: '1'
            }
        };
        validator.validate(req);
        assert.deepEqual(req.query.boolParamTrue, true);
        assert.deepEqual(req.query.boolParamTrueUpperCase, true);
        assert.deepEqual(req.query.boolParamFalse, false);
        assert.deepEqual(req.query.boolParamFalseUpperCase, false);
        assert.deepEqual(req.query.boolParam0, false);
        assert.deepEqual(req.query.boolParam1, true);
    });

    it('Should not coerce string parameters', function() {
        var validator = new Validator([
            { name: 'stringParam', in: 'query', type: 'string' }
        ]);
        var req = {
            query: {
                stringParam: 'true'
            }
        };
        validator.validate(req);
        assert.deepEqual(req.query.stringParam, 'true');
    });

    it('Should not coerce formData for application/json', function() {
        var validator = new Validator([
            {name: 'bodyParam', in: 'formData', type: 'boolean', required: true}
        ]);
        try {
            // The type is incorrect, but wouldn't be coerced, so error will be thrown
            validator.validate({
                headers: {
                    'content-type': 'application/json'
                },
                body: {
                    bodyParam: 'true'
                }
            });
            throw new Error('Should throw error');
        } catch (e) {
            assert.deepEqual(e.constructor.name, 'HTTPError');
            assert.deepEqual(e.body.detail, "data.body.bodyParam should be boolean");
        }
        // Now all is fine, shouldn't throw an error
        validator.validate({
            headers: {
                'content-type': 'application/json'
            },
            body: {
                bodyParam: true
            }
        });
        // Without 'application/json' coercion should be applied
        var req = validator.validate({
            body: {
                bodyParam: 'true'
            }
        });
        assert.deepEqual(req.body.bodyParam, true);
    });

    it('Should accept body params without a schema and type', function() {
        var validator = new Validator([
            {name: 'bodyParam', in: 'body', required: true}
        ]);
        validator.validate({
            body: {
                test: 'test'
            }
        });
        try {
            // The type is incorrect, but wouldn't be coerced, so error will be thrown
            validator.validate({
                body: 'This is a string, and body param must be an object'
            });
            throw new Error('Should throw error');
        } catch (e) {
            assert.deepEqual(e.constructor.name, 'HTTPError');
            assert.deepEqual(e.body.detail, "data.body should be object");
        }
    });

    it('Should allow non-required body', function() {
        var validator = new Validator([
            {name: 'bodyParam', in: 'body'}
        ]);
        validator.validate({});
    })
});