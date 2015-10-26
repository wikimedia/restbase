"use strict";

var HTTPError = require('./rbUtil').HTTPError;
var constructAjv = require('ajv');

var inMapping = {
    path: 'params',
    query: 'query',
    header: 'headers',
    formData: 'body',
    body: 'body'
};

var Validator = function(parameters) {
    this._ajv = constructAjv();
    this._validatorFunc = this._ajv.compile(this._convertToJsonSchema(parameters));
};

/**
 * Converts a list of parameters from a swagger spec
 * to JSON-schema for a request
 *
 * @param parameters list of params
 * @returns JSON schema
 */
Validator.prototype._convertToJsonSchema = function(parameters) {
    var schema = {
        type: 'object',
        properties: {}
    };

    parameters.forEach(function(param) {
        if (param.in !== 'body') {
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

            var reqPartSchema = schema.properties[inMapping[param.in]];
            var paramSchema = {};
            // We can't type-check directly, because everything come in as a string
            if (param.type === 'number') {
                paramSchema.type = 'string';
                paramSchema.pattern = '^\\d+(?:[\\.,]\\d+)?$';
            } else if (param.type === 'integer') {
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
        } else {
            if (param.schema) {
                schema.properties.body = param.schema;
            } else {
                schema.properties.body = {
                    type: 'object'
                };
            }
            if (param.required) {
                schema.required = schema.required || [];
                schema.required.push('body');
            }
        }
    });

    return schema;
};

Validator.prototype.validate = function(req) {
    if (!this._validatorFunc(req)) {
        throw new HTTPError({
            status: 400,
            body: {
                type: 'bad_request',
                title: this._ajv.errorsText(this._validatorFunc.errors),
                req: req
            }
        });
    }
};

module.exports = Validator;