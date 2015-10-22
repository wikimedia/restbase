"use strict";

var HTTPError = require('./rbUtil').HTTPError;
var ajv = require('ajv')();

var inMapping = {
    path: 'params',
    query: 'query',
    header: 'headers',
    formData: 'body'
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
            schema.required = schema.required || [];
            schema.required.push(inMapping[param.in]);
        }
        var reqPartSchema = schema.properties[inMapping[param.in]];
        reqPartSchema.properties[param.name] = {};
        if (param.required) {
            reqPartSchema.required = reqPartSchema.required || [];
            reqPartSchema.required.push(param.name);
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