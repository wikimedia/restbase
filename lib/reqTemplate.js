"use strict";

var URI = require('swagger-router').URI;
var TAssembly = require('tassembly');
var url = require('url');
var expressionCompiler = require('template-expression-compiler');
require('core-js/shim');

var globalMethods = {
    default: function(val, defVal) {
        return val || defVal;
    },
    merge: function(destination, source) {
        destination = destination || {};
        source = source || {};

        if (typeof destination !== 'object' || typeof source !== 'object') {
            throw new Error('Illegal spec. Merge source and destination must be objects');
        }

        var result = Object.assign({}, destination);
        Object.keys(source).forEach(function(keyName) {
            if (result[keyName] === undefined) {
                result[keyName] = source[keyName];
            }
        });
        return result;
    }
};

function splitAndPrepareTAsseblyTemplate(templateSpec, part) {
    var result = [];
    var templateNest = 0;
    var startIndex = 0;
    var currentTemplate;
    for (var index = 0; index < templateSpec.length; index++) {
        if (templateSpec[index] === '{') {
            if (templateNest === 0) { // We are either entering a new template
                if (startIndex !== index) {
                    result.push(templateSpec.substring(startIndex, index));
                }
                startIndex = index + 1;
            } // Or entering an object literal
            templateNest++;
        } else if (templateSpec[index] === '}') {
            if (templateNest === 1) { // The current template is finished
                currentTemplate = templateSpec.substring(startIndex, index);
                var compiledExpression = expressionCompiler.parse(currentTemplate);
                // FIXME: Rewrite path prefixes in expressionCompiler!
                compiledExpression = compiledExpression.replace(/([,(\[:])m\./g,
                            '$1rm.' + part + '.');
                result.push(['raw', compiledExpression]);
                startIndex = index + 1;
            } // Or and object literal finished
            templateNest--;
        }
    }
    if (startIndex !== index) {
        result.push(templateSpec.substring(startIndex));
    }
    if (templateNest > 0) {
        throw new Error('Illegal template, unbalanced curly braces');
    }
    return result;
}

/**
 * Creates a template resolver functuons for URI part of the spec
 * @param {object} spec a root request spec object
 * @returns {Function} a template resolver which should be applied to resolve URI
 */
function createURIResolver(spec) {
    if (/^\{[^\{}]+}$/.test(spec.uri) || /\{\$\$?\..+}/.test(spec.uri)) {
        var tassemblyTemplate = splitAndPrepareTAsseblyTemplate(spec.uri);
        var resolver = compileTAssembly(tassemblyTemplate, 'params');
        return function(context) {
            var value = resolver(context);
            if (value.constructor !== URI) {
                value = new URI(value, {}, false);
            }
            return value;
        };
    } else if (/^(?:https?:\/\/)?\{[^\/]+}\//.test(spec.uri)) {
        // The host is templated - replace it with TAssembly and use URI.expand for path templates
        var hostTemplate = /^((?:https?:\/\/)?\{[^\/]+}\/)/.exec(spec.uri)[1];
        var hostTassembly = splitAndPrepareTAsseblyTemplate(hostTemplate);
        var hostResolver = compileTAssembly(hostTassembly, 'params');
        var path = spec.uri.substr(hostTemplate.length);
        var pathTemplate = new URI('/' + path, {}, true);
        return function(context) {
            var newHost = hostResolver(context);
            // FIXME: Support references to other parts of the request.
            // params['$'] = context.rm;
            var newUri = pathTemplate.expand(context.rm.request.params);
            newUri.urlObj = url.parse(newHost + path);
            return newUri;
        };
    } else {
        return (function(uri) {
            var uriTemplate = new URI(uri, {}, true);
            return function(context) {
                return uriTemplate.expand(context.rm.request.params);
            };
        })(spec.uri);
    }
}

function errorHandler(e) {
    console.error('ERR', e);
    return undefined;
}

function compileTAssembly(template, reqPart) {
    var res;
    var callback = function(bit) {
        if (res === undefined) {
            res = bit;
        } else {
            res += '' + bit;
        }
    };

    var options = {
        nestedTemplate: true,
        errorHandler: errorHandler,
        cb: callback,
        globals: globalMethods,
    };
    var resolveTemplate = TAssembly.compile(template, options);

    return function(context) {
        var childContext = {
            rc: context.rc,
            rm: context.rm,
            m: context.rm.request[reqPart],
            cb: options.cb,
            options: context.options || options,
        };

        resolveTemplate(childContext);
        var value = res;
        res = undefined; // Unitialize res to prepare to the next request
        return value;
    };
}

/**
 * Rewrite a request template to a valid tassembly expression template.
 *
 * Copies the object on write.
 */
function replaceComplexTemplates(part, subSpec, globals) {
    if (subSpec && subSpec.constructor === Object) {
        var res = {};
        Object.keys(subSpec).forEach(function(key) {
            res[key] = replaceComplexTemplates(part, subSpec[key], globals);
        });
        return res;
    } else if (Array.isArray(subSpec)) {
        return subSpec.map(function(elem) {
            return replaceComplexTemplates(part, elem, globals);
        });
    } else if (subSpec && subSpec.constructor === String || subSpec === '') {
        if (/\{.*\}/.test(subSpec)) {
            // There is a template, now we need to check it for special stuff we replace
            if (/^\{[^\}\[]+\}$/.test(subSpec)) {
                // Simple variable: Remove braces
                subSpec = subSpec.substring(1, subSpec.length - 1);
                // FIXME: Replace with proper rewriting using the expression
                // compiler.
                subSpec = subSpec.replace(/([,(\[:] *)([a-z_])/g,
                            '$1$.request.' + part + '.$2');
            }
            if (!/^[\$'"]/.test(subSpec) && !/[\{\[\(]/.test(subSpec)) {
                // Simple local reference
                // XXX: won't handle nested references
                return '$.request.' + part + '.' + subSpec;
            } else {
                var tAssemblyTemplates = splitAndPrepareTAsseblyTemplate(subSpec, part);
                if (tAssemblyTemplates.length > 1) {
                    // This is a string with partial templates
                    // Compile a function
                    var resolver = compileTAssembly(tAssemblyTemplates, part);
                    // Replace the complex template with a function call
                    var fnName = 'fn_' + globals._i++;
                    globals[fnName] = resolver;
                    return '$$.' + fnName + '($context)';
                } else if (/^\{.*\}$/.test(subSpec)) {
                    // If it's a simple and resolvable function - just remove the braces
                    return subSpec.substring(1, subSpec.length - 1);
                } else {
                    return subSpec;
                }
            }
        } else {
            // If it's not templated - wrap it into braces to let tassembly add it
            return "'" + subSpec + "'";
        }
    } else {
        // Other literals: Number, booleans
        return subSpec;
    }
    return subSpec;
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
    spec = Object.assign({}, spec);
    var self = this;
    var globals = Object.assign({}, globalMethods);
    globals._i = 0;
    Object.keys(spec).forEach(function(part) {
        if (part === 'uri') {
            globals.uri = createURIResolver(spec);
            spec.uri = '$$.uri($context)';
        } else if (part === 'method') {
            spec.method = "'" + (spec.method || 'get') + "'";
        } else {
            spec[part] = replaceComplexTemplates(part, spec[part], globals);
        }
    });

    var completeTAssemblyTemplate;
    try {
        completeTAssemblyTemplate = expressionCompiler.parse(spec);
    } catch (e) {
        console.log('COMPILE ERROR');
        console.log(JSON.stringify(spec, null, 2));
        console.log(e);
        throw e;
    }

    var res;
    var callback = function(bit) {
        if (res === undefined) {
            res = bit;
        } else {
            res += '' + bit;
        }
    };
    var resolver = TAssembly.compile([['raw', completeTAssemblyTemplate]], {
        nestedTemplate: true,
        globals: globals,
        cb: callback,
        errorHandler: errorHandler
    });
    var options = {
        errorHandler: errorHandler
    };
    var c = {
        rc: null,
        g: globals,
        options: options,
        cb: callback,
    };
    c.rc = c;
    self.expand = function(m) {
        c.rm = m;
        c.m = m;
        resolver(c);
        var ret = res;
        res = undefined;
        return ret;
    };
}

/**
 * Evaluates the compiled template using the provided request
 *
 * @param {object} context a context object where to take data from
 * @returns {object} a new request object with all templates either substituted or dropped
 */
Template.prototype.expand = null;

module.exports = Template;
