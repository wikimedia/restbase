"use strict";

var URI = require('swagger-router').URI;
var rbUtil = require('./rbUtil');
var TAssembly = require('tassembly');

/**
 * Creates a function that sets a value at the path
 * or deletes if undefined values is provided.
 */
function _setAtPathFun(path) {
    var ref = path.split('.').map(function(elem) {
        return '["' + elem + '"]';
    }).join('');
    var code =  'if (value !== undefined) {\n' +
                '   obj' + ref + ' = value;\n' +
                '} else {\n' +
                '   delete obj' + ref +';\n' +
                '}';
    /* jslint evil: true */
    return new Function('obj', 'value', code);
}

function _createTemplateResolvers(subspec, reqPart, path, resolvers) {
    var resolveTemplate = function(templateSpec, templatePath) {
        if (templateSpec instanceof Object) {
            _createTemplateResolvers(templateSpec, reqPart, templatePath, resolvers);
        } else if (/^\{[^}]+}$/.test(templateSpec)) {
            var template = /^\{([^}]+)}$/.exec(templateSpec)[1];
            if (template.indexOf('$.request') === 0) {
                template = template.replace('$.request', 'm');
            } else {
                template = 'm.' + reqPart + '.' + template;
            }
            var getValue = TAssembly.compile([['raw', template]], {
                errorHandler: function() { return undefined; },
                identityCallback: true
            });
            var setValue = _setAtPathFun(templatePath);
            resolvers.push(function(newReq, req) {
                var value = getValue(req);
                setValue(newReq, value);
            });
        }
    };

    if (!resolvers) {
        resolvers = [];
    }
    if (!path) {
        path = reqPart;
    }
    if (subspec instanceof Object) {
        Object.keys(subspec).forEach(function(key) {
            resolveTemplate(subspec[key], path + '.' + key);
        });
    } else {
        resolveTemplate(subspec, path);
    }
    return resolvers;
}

/**
 * Creates and compiles a new Template object using the provided JSON spec
 *
 * @param spec request spec
 */
function Template(spec) {
    var uriTemplate = new URI(spec.uri, {}, true);
    var self = this;

    self.spec = spec;
    self._evalUri = function(req) {
        return uriTemplate.expand(req.params);
    };
    if (!spec.method) {
        self._evalMethod = function(req) {
            return req.method;
        };
    }
    self.resolvers = [];
    ['headers', 'body', 'query'].forEach(function(reqPart) {
        if (spec[reqPart]) {
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
    // Deep copy the spec, because it's faster than traverse it trying to find added values
    var newReq = JSON.parse(JSON.stringify(this.spec));
    newReq.uri = this._evalUri(req);
    newReq.params = req.params;
    if (this._evalMethod) {
        newReq.method = this._evalMethod(req);
    }
    this.resolvers.forEach(function(resolver) {
        resolver(newReq, req);
    });
    return newReq;
};

module.exports = Template;
