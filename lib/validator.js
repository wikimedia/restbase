"use strict";

var HTTPError = require('./exports').HTTPError;
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
    this._paramCoercionFunc = this._createTypeCoercionFunc(parameters.filter(function(p) {
        return p.in !== 'formData' && p.in !== 'body' && p.type !== 'string';
    }));
    this._bodyCoercionFunc = this._createTypeCoercionFunc(parameters.filter(function(p) {
        return p.in === 'formData' && p.type !== 'string';
    }));
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
                schema.required.push(inMapping[param.in]);
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
 * @returns {Function<req, HTTPError>} coercion function
 * @private
 */
Validator.prototype._createTypeCoercionFunc = function(parameters) {
    var code = '';
    parameters.forEach(function(param) {
        var paramAccessor = 'req.' + inMapping[param.in] + '["' + param.name + '"]';
        var paramCoercionCode = '';
        var errorNotifier;
        switch (param.type) {
            case 'integer':
                errorNotifier = 'throw new HTTPError({status:400,body:{type:"bad_request",'
                    + ' title:"Invalid parameters", detail: "data.'
                    + inMapping[param.in] + '.' + param.name + ' should be an integer"}});\n';
                paramCoercionCode += paramAccessor + ' = parseInt(' + paramAccessor + ');\n'
                    + 'if (!Number.isInteger(' + paramAccessor + ')) {\n' + errorNotifier + '}\n';
                break;
            case 'number':
                errorNotifier = 'throw new HTTPError({status:400,body:{type:"bad_request",'
                    + ' title:"Invalid parameters", detail: "data.'
                    + inMapping[param.in] + '.' + param.name + ' should be a number"}});\n';
                paramCoercionCode += paramAccessor + ' = parseFloat(' + paramAccessor + ');\n'
                    + 'if (Number.isNaN(' + paramAccessor + ')) {\n' + errorNotifier + '}\n';
                break;
            case 'boolean':
                errorNotifier = 'throw new HTTPError({status:400,body:{type:"bad_request",'
                    + ' title:"Invalid parameters", detail: "data.'
                    + inMapping[param.in] + '.' + param.name + ' should be a boolean.'
                    + ' true|false|1|0 is accepted as a boolean."}});\n';
                paramCoercionCode += 'if(!/^true|false|1|0$/i.test('
                    + paramAccessor + ' + "")) {\n'
                    + errorNotifier + '}\n'
                    + paramAccessor + ' = /^true|1$/i.test('
                    + paramAccessor + ' + "");\n';
        }

        if (paramCoercionCode) {
            var wrapperConditions = 'typeof ' + paramAccessor + " === 'string'";
            if (!param.required) {
                // If parameter is not required, don't try to coerce "undefined"
                wrapperConditions += ' && ' + paramAccessor + ' !== undefined';
            }
            paramCoercionCode = 'if (' + wrapperConditions + ') {\n'
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
    if (this._paramCoercionFunc) {
        req = this._paramCoercionFunc(req, HTTPError);
    }
    if (this._bodyCoercionFunc &&
            (!req.headers || !/^ *application\/json/i.test(req.headers['content-type']))) {
        req = this._bodyCoercionFunc(req, HTTPError);
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
    return req;
};

module.exports = Validator;
