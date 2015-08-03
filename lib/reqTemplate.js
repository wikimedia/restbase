"use strict";

var URI = require('swagger-router').URI;
var rbUtil = require('./rbUtil');
var TAssembly = require('tassembly');

/**
 * Creates a function that sets a value at the path and initializes all objects/arrays along the path.
 *
 * @param path the path within an object/array separated with dots {e.g. test.body.a.b.c}
 * @returns {Function} the function to set a value at path and initialize object along the path if needed
 * @private
 */
function _setAtPath(path, spec) {
    var pathArr = path.split('.');
    var refArr = [];
    var subspec = spec;
    var code;

    for (var idx = 0; idx < pathArr.length; idx++) {
        var curRef = {};
        curRef.ref = Array.isArray(subspec) ? '[' + pathArr[idx] + ']' : '["' + pathArr[idx] + '"]';
        subspec = subspec[pathArr[idx]];
        curRef.initializer = Array.isArray(subspec) ? '[]' : '{}';
        refArr.push(curRef);
    }

    code =  'if (value !== undefined) {\n';
    for (var i = 1; i < refArr.length; i++) {
        var ref = refArr.slice(0, i).map(function(elem) { return elem.ref; }).join('');
        code += 'obj' + ref + ' = obj' + ref + ' || ' + refArr[i - 1].initializer + ';\n';
    }
    code += 'obj' + refArr.map(function(elem) { return elem.ref; }).join('') + ' = value;\n';
    code += '}';

    /* jslint evil: true */
    return new Function('obj', 'value', code);
}

/**
 * Validates and prepares the template string - resolves local references
 * and wraps property access to ["..."]
 *
 * @param {string} template an original template string
 * @param {string} defaultLookupPath a default path withing the context which
 *                 to look if template is local
 * @returns {string} validated and
 */
function prepareTemplateString(template, defaultLookupPath) {
    if (!/^(\$\.)?([a-zA-Z][a-zA-Z0-9-_]*)(\.[a-zA-Z][a-zA-Z0-9-_]*)*$/.test(template)) {
        throw new Error('Invalid template ' + template);
    }

    if (template[0] === '$') {
        template = 'rm' + template.slice(1);
    } else {
        template = 'm.request.' + defaultLookupPath + '.' + template;
    }
    return template.replace(/\.([^.]*(?:-[^.]*)+)/g, function(all, paren) {
        return "['" + paren.replace(/'/g, "\\'") + "']";
    });
}

/**
 * Wraps a template into a uriEncode function call
 *
 * @param {string} template and original template string
 * @param {boolean} uriEncode if true the template string will be wrapped into a function call
 * @returns {string} modified template string
 */
function wrapUriEncode(template, uriEncode) {
    if (uriEncode) {
        return 'rm.func.encode(' + template + ')';
    }
    return template;
}

/**
 * Compiles a template into a function
 *
 * @param templateSpec template string (e.g. '{$.request.body.a}')
 * @param reqPart part of the request to lookup local properties in (e.g. headers, body etc.)
 * @param setValue callback for a result of template evaluation
 * @param {boolean} uriEncode if true the values are uri-encoded
 * @returns {[Function]} array of template resolvers for the provided template
 */
function compileTemplate(templateSpec, setValue, reqPart, uriEncode) {
    var template;
    var templatedString;
    var prevIndex = 0;
    var completeTemplate = /^\{([^}]+)}$/.exec(templateSpec);
    if (completeTemplate && completeTemplate.length > 0) {
        template = [['raw', prepareTemplateString(completeTemplate[1], reqPart)]];
    } else {
        template = [];
        templateSpec.replace(/\{([^}]+)}/g, function(full, spec, index) {
            if (prevIndex !== index) {
                template.push(templateSpec.substring(prevIndex, index));
            }
            if (spec[0] === '+') {
                template.push(['text', prepareTemplateString(spec.substr(1), reqPart)]);
            } else if (spec[0] === '/') {
                // Support for optional path parts (e.g. {/tid})
                spec = spec.substr(1);
                templatedString = prepareTemplateString(spec, reqPart);
                template.push(['if', {
                    data: templatedString,
                    tpl: ['/', ['text', wrapUriEncode(templatedString, uriEncode)]]
                }]);
            } else {
                templatedString = prepareTemplateString(spec, reqPart);
                template.push(['text', wrapUriEncode(templatedString, uriEncode)]);
            }
            prevIndex = index + full.length;
        });
        if (prevIndex !== templateSpec.length) {
            template.push(templateSpec.substring(prevIndex, templateSpec.length));
        }
    }

    var res;
    var resolveTemplate = TAssembly.compile(template, {
        errorHandler: function() { return undefined; },
        cb: function(bit) {
            if (res === undefined) {
                res = bit;
            } else {
                res += '' + bit;
            }
        }
    });
    return [ function(newReq, context) {
        resolveTemplate(context);
        var value = res;
        res = undefined; // Unitialize res to prepare to the next request
        setValue(newReq, value);
    } ];
}

/**
 *  Constructs a list of resolvers for all templates in a request spec
 *
 * @param subspec a request spec or subspec for a part of request
 * @param reqPart name of request part (e.g. headers, body, query)
 * @param path path to the current subspec within a full spec
 * @returns {Array} an array of template resolvers for every template found in the spec.
 *          Resolvers are functions with (newRequest, request) arguments that modify newRequest param.
 * @private
 */
function _createTemplateResolvers(origSpec, subspec, reqPart, path) {

    /**
     * Makes an array of resolvers for every template found within a template spec object.
     *
     * @param templateSpec A subspec of an original request spec.
     * @param templatePath A path to the current subspec
     * @returns {Array} and array of resolvers for each template found in the subspec
     */
    function makeResolvers(templateSpec, templatePath) {
        var setValue = _setAtPath(templatePath, origSpec);
        if (templateSpec instanceof Object) {
            return _createTemplateResolvers(origSpec, templateSpec, reqPart, templatePath);
        } else if (/\{[^}]+}/.test(templateSpec)) {
            return compileTemplate(templateSpec, setValue, reqPart);
        } else {
            return [ function(newReq) { setValue(newReq, templateSpec); } ];
        }
    }

    if (!path) { path = reqPart; }
    if (subspec instanceof Object) {
        return Object.keys(subspec).map(function(key) {
            return makeResolvers(subspec[key], path + '.' + key);
        }).reduce(function(arr1, arr2) { return arr1.concat(arr2); });
    } else {
        return makeResolvers(subspec, path);
    }
}

/**
 * Creates and compiles a new Template object using the provided JSON spec
 *
 * @param spec  Request spec provided in a Swagger spec. This is a JSON object
 *              containing all request parts templated in the form of {a.b.c}.
 *              Only fields in the spec would be included in the resulting request,
 *              fields that couldn't be resolved from original request would be ignored.
 */
function Template(spec) {
    var self = this;
    self.resolvers = [];
    Object.keys(spec).forEach(function(reqPart) {
        var setValue;
        if (reqPart === 'uri') {
            var uriSetter = _setAtPath('uri', spec);
            setValue = function(newReq, value) {
                if (value.constructor !== URI) {
                    value = new URI(value, {}, false);
                }
                uriSetter(newReq, value);
            };
            if (/\{[^\{}]+}/.test(spec.uri)) {
                compileTemplate(spec.uri, setValue, 'params', true).forEach(function(resolver) {
                    self.resolvers.push(resolver);
                });
            } else {
                var uriTemplate = new URI(spec.uri, {}, false);
                self.resolvers.push(function(newReq) {
                    setValue(newReq, uriTemplate);
                });
            }
        } else if (reqPart === 'method') {
            setValue = _setAtPath('method', spec);
            self.resolvers.push(function(newReq) {
                setValue(newReq, spec.method);
            });
        } else if (spec[reqPart]) {
            self.resolvers = self.resolvers.concat(_createTemplateResolvers(spec, spec[reqPart], reqPart));
        }
    });
}

/**
 * Adds common functions to the context.func object,
 * so that they could be used in templates as rm.func.funcName
 *
 * @param {object} context a request context to put common functions to
 */
function appendCommonOperators(context) {
    context.func = {
        encode: function(value) {
            return encodeURIComponent(value);
        }
    };
}
/**
 * Evaluates the compiled template using the provided request
 *
 * @param req a request object where to take data from
 * @returns {*} a new request object with all templates either substituted or dropped
 */
Template.prototype.eval = function(context) {
    var newReq = { method: context.request.method };
    appendCommonOperators(context);
    this.resolvers.forEach(function(resolver) {
        resolver(newReq, context);
    });
    return newReq;
};

module.exports = Template;