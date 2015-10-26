"use strict";

var HTTPError = require('./rbUtil').HTTPError;
var ajv = require('ajv')();

var inMapping = {
    path: 'params',
    query: 'query',
    header: 'headers',
    formData: 'body',
    body: 'body'
};

/**
 * Converts a list of parameters from a swagger spec
 * to JSON-schema for a request
 *
 * @param parameters list of params
 * @returns JSON schema
 */
function convertToJsonSchema(parameters) {
    var schema = {
        type: 'object',
        properties: {}
    };

    parameters.forEach(function(param) {
        if (!schema.properties[inMapping[param.in]]) {
            schema.properties[inMapping[param.in]] = {
                type: 'object',
                properties: {}
            };
            // 'required' array must have at least one element according to json-schema spec,
            // se we can't preinitialize it.
            schema.required = schema.required || [];
            schema.required.push(inMapping[param.in]);
        }
        if (param.in !== 'body') {
            var reqPartSchema = schema.properties[inMapping[param.in]];
            var paramSchema = {};
            // We can't type-check directly, because everything come in as a string
            if (param.type === 'number' || param.type === 'integer') {
                paramSchema.type = 'string';
                paramSchema.pattern = '^\\d+$';
            } else if (param.type === 'boolean') {
                paramSchema.type = 'string';
                paramSchema.pattern = '^(?:true)|(?:false)|(?:1)|(?:0)$';
            } else if (param.type === 'string') {
                paramSchema.type = 'string';
                paramSchema.enum = param.enum;
                paramSchema.maxLength = param.maxLength;
                paramSchema.minLength = param.minLength;
                paramSchema.pattern = param.pattern;
            }
            reqPartSchema.properties[param.name] = paramSchema;
            if (param.required) {
                reqPartSchema.required = reqPartSchema.required || [];
                reqPartSchema.required.push(param.name);
            }
        }
    });

    return schema;
}

var Validator = function(parameters) {
    this.parameters = parameters;
    this._validatorFunc = ajv.compile(convertToJsonSchema(parameters));
};

Validator.prototype.validate = function(req) {
    if (!this._validatorFunc(req)) {
        console.log(ajv.errorsText(this._validatorFunc.errors));
        throw new HTTPError({
            status: 400,
            body: {
                type: 'bad_request',
                title: ajv.errorsText(this._validatorFunc.errors),
                req: req
            }
        });
    }
};

module.exports = Validator;