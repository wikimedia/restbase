"use strict";

var URI = require('swagger-router').URI;
var rbUtil = require('./rbUtil');
var TAssembly = require('tassembly');
var url = require('url');
var sha1 = require('sha1');
var stringify = require('json-stable-stringify');

/**
 * Creates a function that sets a value at the path
 * and initializes all objects/arrays along the path.
 *
 * @param {string} path the path within an object/array separated
 *        with dots {e.g. test.body.a.b.c}
 * @param {object} spec spec element that contains provided path
 * @returns {Function} the function to set a value at path
 *          and initialize object along the path if needed
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
 * Compiles a template into a function
 *
 * @param templateSpec template string (e.g. '{$.request.body.a}')
 * @param reqPart part of the request to lookup local properties in (e.g. headers, body etc.)
 * @param setValue callback for a result of template evaluation
 * @returns {Function} a template resolver for the provided template
 */
function compileTemplate(templateSpec, setValue, reqPart) {
    var template;
    var prevIndex = 0;

    // Special case - lazy-evaluation of a request hash property
    if (templateSpec === '{$.request.hash}') {
        return function(newReq, context) {
            // Need to remove x-request-id header if it's present
            var reqId = context.request.headers && context.request.headers['x-request-id'];
            if (reqId) {
                delete context.request.headers['x-request-id'];
            }

            setValue(newReq, sha1(stringify(context.request)));

            if (reqId) {
                context.request.headers['x-request-id'] = reqId;
            }
        };
    }

    var completeTemplate = /^\{([^}]+)}$/.exec(templateSpec);
    if (completeTemplate && completeTemplate.length > 0) {
        template = [['raw', prepareTemplateString(completeTemplate[1], reqPart)]];
    } else {
        var re = /\{([^}]+)}/g;
        template = [];
        var match;
        do {
            match = re.exec(templateSpec);
            if (match) {
                if (match.index !== prevIndex) {
                    template.push(templateSpec.substring(prevIndex, match.index));
                }
                template.push(['raw', prepareTemplateString(match[1], reqPart)]);
                prevIndex = match.index + match[0].length;
            } else if (prevIndex !== templateSpec.length) {
                template.push(templateSpec.substring(prevIndex, templateSpec.length));
            }
        } while (match);
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
    return function(newReq, context) {
        resolveTemplate(context);
        var value = res;
        res = undefined; // Unitialize res to prepare to the next request
        setValue(newReq, value);
    };
}

/**
 *  Constructs a list of resolvers for all templates in a request spec
 *
 * @param origSpec original full spec
 * @param subspec a request spec or subspec for a part of request
 * @param reqPart name of request part (e.g. headers, body, query)
 * @param path path to the current subspec within a full spec
 * @returns {Array} an array of template resolvers for every template found in the spec.
 *          Resolvers are functions with (newRequest, request) arguments
 *          that modify newRequest param.
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
            return [ compileTemplate(templateSpec, setValue, reqPart) ];
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
 * Creates a template resolver functuons for URI part of the spec
 * @param {object} spec a root request spec object
 * @returns {Function} a template resolver which should be applied to resolve URI
 */
function createURIResolver(spec) {
    var setter = _setAtPath('uri', spec);
    if (/^\{[^\{}]+}$/.test(spec.uri)) {
        var setValue = function(newReq, value) {
            if (value.constructor !== URI) {
                value = new URI(value, {}, false);
            }
            setter(newReq, value);
        };
        return compileTemplate(spec.uri, setValue, 'params');
    } else if (/^(?:https?:\/\/)?\{[^\/]+}\//.test(spec.uri)) {
        // The host is templated - replace it with TAssembly and use URI.expand for path templates
        var hostTemplate = /^((?:https?:\/\/)?\{[^\/]+}\/)/.exec(spec.uri)[1];
        var hostResolver = compileTemplate(hostTemplate, setter, 'params');
        var path = spec.uri.substr(hostTemplate.length);
        var pathTemplate = new URI('/' + path, {}, true);
        return function(newReq, context) {
            hostResolver(newReq, context);
            var newUri = pathTemplate.expand(context.request.params);
            newUri.urlObj = url.parse(newReq.uri + path);
            setter(newReq, newUri);
        };
    } else {
        var uriTemplate = new URI(spec.uri, {}, true);
        return function(newReq, context) {
            setter(newReq, uriTemplate.expand(context.request.params));
        };
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
    if (typeof spec === 'string') {
        self.resolvers.push(compileTemplate(spec, function(newReq, val) {
            newReq.val = val;
        }));

        self._eval = function(context) {
            var result = {};
            this.resolvers.forEach(function(resolver) {
                resolver(result, context);
            });
            return result.val;
        };
    } else {
        Object.keys(spec).forEach(function(reqPart) {
            var setValue;
            if (reqPart === 'uri') {
                self.resolvers.push(createURIResolver(spec));
            } else if (reqPart === 'method') {
                setValue = _setAtPath('method', spec);
                self.resolvers.push(function(newReq) {
                    setValue(newReq, spec.method);
                });
            } else if (spec[reqPart]) {
                self.resolvers = self.resolvers.concat(
                    _createTemplateResolvers(spec, spec[reqPart], reqPart));
            }
        });

        self._eval = function(context) {
            var newReq = { method: context.request.method };
            this.resolvers.forEach(function(resolver) {
                resolver(newReq, context);
            });
            return newReq;
        };
    }
}

/**
 * Evaluates the compiled template using the provided request
 *
 * @param {object} context a context object where to take data from
 * @returns {object} a new request object with all templates either substituted or dropped
 */
Template.prototype.eval = function(context) {
    return this._eval(context);
};

module.exports = Template;