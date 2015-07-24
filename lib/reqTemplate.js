"use strict";

var URI = require('swagger-router').URI;
var rbUtil = require('./rbUtil');
var TAssembly = require('tassembly');

/**
 * Creates a function that sets a value at the path and initializes all objects along the path.
 *
 * @param path the path within an object separated with dots {e.g. test.body.a.b.c}
 * @returns {Function} the function to set a value at path and initialize object along the path if needed
 * @private
 */
function _setAtPath(path) {
    var refArr = path.split('.').map(function(elem) {
        return '["' + elem + '"]';
    });
    var code =  'if (value !== undefined) {\n';
    for (var i = 1; i < refArr.length; i++) {
        var ref = refArr.slice(0, i).join('');
        code += 'obj' + ref + ' = obj' + ref + ' || {};\n';
    }
    code += 'obj' + refArr.join('') + ' = value;\n';
    code += '}';
    /* jslint evil: true */
    return new Function('obj', 'value', code);
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
function _createTemplateResolvers(subspec, reqPart, path) {

    /**
     * Makes an array of resolvers for every template found within a template spec object.
     *
     * @param templateSpec A subspec of an original request spec.
     * @param templatePath A path to the current subspec
     * @returns {Array} and array of resolvers for each template found in the subspec
     */
    function makeResolvers(templateSpec, templatePath) {
        var setValue = _setAtPath(templatePath);
        if (templateSpec instanceof Object) {
            return _createTemplateResolvers(templateSpec, reqPart, templatePath);
        } else if (/^\{[^}]+}$/.test(templateSpec)) {
            var template = /^\{([^}]+)}$/.exec(templateSpec)[1];
            var buildModel;

            if (!/^(\$\.)?([a-zA-Z][a-zA-Z0-9-]*)(\.[a-zA-Z][a-zA-Z0-9-]*)*$/.test(template)) {
                throw new Error('Invalid template ' + template);
            }

            if (template.indexOf('$.') === 0) {
                template = template.replace('$', 'rm');
                buildModel = function(req) { return { request: req }; };
            } else {
                template = 'm.' + template;
                buildModel = function(req) { return req[reqPart]; };
            }

            var getValue = TAssembly.compile([['raw', template]], {
                errorHandler: function() { return undefined; }
            });

            return [ function(newReq, req) { setValue(newReq, getValue(buildModel(req))); } ];
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
            var uriTemplate = new URI(spec.uri, {}, true);
            setValue = _setAtPath('uri');
            self.resolvers.push(function(newReq, req) {
                setValue(newReq, uriTemplate.expand(req.params));
            });
        } else if (reqPart === 'method') {
            setValue = _setAtPath('method');
            self.resolvers.push(function(newReq) {
                setValue(newReq, spec.method);
            });
        } else if (spec[reqPart]) {
            self.resolvers = self.resolvers.concat(_createTemplateResolvers(spec[reqPart], reqPart));
        }
    });
}

/**
 * Evaluates the compiled template using the provided request
 *
 * @param req a request object where to take data from
 * @returns {*} a new request object with all templates either substituted or dropped
 */
Template.prototype.eval = function(req) {
    var newReq = { method: req.method };
    this.resolvers.forEach(function(resolver) {
        resolver(newReq, req);
    });
    return newReq;
};

module.exports = Template;
