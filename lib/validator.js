"use strict";

var HTTPError = require('./rbUtil').HTTPError;
var constructAjv = require('ajv');

/**
 * Mapping of `param.in` field to the name of a request part.
 *
 * @const
 * @type {{path: string, query: string, header: string, formData: string, body: string}}
 */
var inMapping = {
    path: 'params',
    query: 'query',
    header: 'headers',
    formData: 'body',
    body: 'body'
};

/**
 * Supported field validators.
 *
 * @const
 * @type {string[]}
 */
var supportedValidators = ['maximum',
    'exclusiveMaximum',
    'minimum',
    'exclusiveMinimum',
    'maxLength',
    'minLength',
    'pattern',
    'maxItems',
    'minItems',
    'uniqueItems',
    'enum',
    'multipleOf'];

/**
 * Constructs a request validator, according to swagger parameters specification.
 * A returned object contains a single `validate(req)` function.
 *
 * @param parameters {Array} swagger parameters spec
 * @constructor
 */
var Validator = function(parameters) {
    this._ajv = constructAjv();
    this._typeCoercionFunc = this._createTypeCoercionFunc(parameters);
    this._validatorFunc = this._ajv.compile(this._convertToJsonSchema(parameters));
};

/**
 * Converts a list of parameters from a swagger spec
 * to JSON-schema for a request
 *
 * @param parameters list of params
 * @returns {Object} JSON schema
 * @private
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
                if (schema.required.indexOf(inMapping[param.in]) < 0) {
                    schema.required.push(inMapping[param.in]);
                }
            }

            var reqPartSchema = schema.properties[inMapping[param.in]];
            var paramSchema = { type: param.type };
            supportedValidators.forEach(function(validator) {
                paramSchema[validator] = param[validator];
            });
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

/**
 * Creates a function, that tries to coerce types of parameters in the
 * incoming request, according to the provided parameters specification.
 *
 * @param parameters {Array} parameters swagger specification
 * @returns {Function(req, HTTPError)} cersion function
 * @private
 */
Validator.prototype._createTypeCoercionFunc = function(parameters) {
    var code = '';
    parameters.forEach(function(param) {
        if (param.type === 'string') {
            // Don't need to process strings
            return;
        }
        var paramAccessor = 'req.' + inMapping[param.in] + '["' + param.name + '"]';
        var paramCoercionCode;
        var errorNotifier = 'throw new HTTPError({status:400,body:{type:"bad_request",'
                + ' title:"Invalid parameters", detail: "data.'
                + inMapping[param.in] + '.' + param.name + ' should be ' + param.type + '"}});\n';

        switch (param.type) {
            case 'integer':
                paramCoercionCode = paramAccessor + ' = parseInt(' + paramAccessor + ');\n'
                    + 'if (!Number.isInteger(' + paramAccessor + ')) {\n' + errorNotifier + '}\n';
                break;
            case 'number':
                paramCoercionCode = paramAccessor + ' = parseFloat(' + paramAccessor + ');\n'
                    + 'if (Number.isNaN(' + paramAccessor + ')) {\n' + errorNotifier + '}\n';
                break;
            case 'boolean':
                paramCoercionCode = 'if(!/^true|false|1|0$/.test('
                    + paramAccessor + '.toString())) {\n'
                    + errorNotifier + '}\n'
                    + paramAccessor + ' = /^true|1$/.test('
                    + paramAccessor + '.toString());\n';
        }

        if (!paramCoercionCode) {
            return;
        }

        if (!param.required) {
            // If parameter is not required, don't try to coerce "undefined"
            paramCoercionCode = 'if (' + paramAccessor + ' !== undefined) {\n'
                + paramCoercionCode + '}\n';
        }

        code += paramCoercionCode;
    });
    if (code && code.trim()) {
        code += '\nreturn req;\n';
        /*jshint evil:true */
        return new Function('req', 'HTTPError', code);
    } else {
        return undefined;
    }
};

/**
 * Validates a request. In case of an error, throws HTTPError with 400 code
 * @param req {Object} a request object to validate.
 */
Validator.prototype.validate = function(req) {
    if (this._typeCoercionFunc) {
        req = this._typeCoercionFunc(req, HTTPError);
    }
    if (!this._validatorFunc(req)) {
        throw new HTTPError({
            status: 400,
            body: {
                type: 'bad_request',
                title: 'Invalid parameters',
                detail: this._ajv.errorsText(this._validatorFunc.errors),
                req: req
            }
        });
    }
};

module.exports = Validator;