"use strict";

var URI = require('swagger-router').URI;
var rbUtil = require('./rbUtil');
var TAssembly = require('tassembly');

function _setAtPath(obj, value, path) {
    var i;
    path = path.split('.');
    for (i = 0; i < path.length - 1; i++) {
        obj = obj[path[i]];
    }
    if (value !== undefined) {
        obj[path[i]] = value;
    } else {
        delete obj[path[i]];
    }
}

function _createTemplateResolvers(subspec, reqPart, path, resolvers) {
    if (!resolvers) {
        resolvers = [];
    }
    if (!path) {
        path = reqPart;
    }
    Object.keys(subspec).forEach(function(key) {
        if (subspec[key] instanceof Object) {
            _createTemplateResolvers(subspec[key], reqPart, path + '.' + key, resolvers);
        } else if (/^\{[^}]+}$/.test(subspec[key])) {
            var template = /^\{([^}]+)}$/.exec(subspec[key])[1];
            if (template.indexOf('$.req') === 0) {
                template.replace('$.req', 'm');
            } else {
                template = 'm.' + reqPart + '.' + template;
            }
            var compiled = TAssembly.compile([['raw', template]], {
                cb: function(val) { return val; }
            });
            resolvers.push(function(newReq, req) {
                var value = compiled(req);
                _setAtPath(newReq, value, path + '.' + key);
            });
        }
    });
    return resolvers;
}

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

Template.prototype.eval = function(req) {
    var self = this;
    var newReq = self.spec;
    newReq.uri = self._evalUri(req);
    if (self._evalMethod) {
        newReq.method = self._evalMethod(req);
    }
    self.resolvers.forEach(function(resolver) {
        resolver(newReq, req);
    });
    return newReq;
};

module.exports = Template;