"use strict";

var P       = require('bluebird');
var rbUtil  = require('./rbUtil');
var URI     = require('swagger-router').URI;


/**
 * From a list of uri Regex and values, constructs a regex to check if the
 * request URI is in the white-list.
 */
function constructInternalRequestRegex(reqWhiteList) {
    var internalReqRegex = (reqWhiteList || []).map(function(regex) {
        if (/^\/.+\/$/.test(regex)) {
            return '(:?' + regex.substring(1, regex.length - 1) + ')';
        } else {
            // Instead of comparing strings
            return '(:?^' + regex.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&") + ')';
        }
    }).join('|');
    return internalReqRegex && internalReqRegex.length > 0
        ? new RegExp(internalReqRegex) : undefined;
}

/**
 * A collection of known security requirement object checker factories.
 * Returns a checker object, identified by the security requirement name,
 * and containing 2 functions: prepareRequest and checkPermissions
 * - prepareRequest(restbase, req) - preforms modifications on the request,
 *                                   needed by the security scheme
 * - checkPermissions(restbase, req, permissions) - checks that all permissions are present.
 */
var securityDefinitionCreators = {
    mediawiki_auth: function(definition) {
        var internalRequestWhitelist
            = constructInternalRequestRegex(definition['x-internal-request-whitelist']);

        function isInternalRequest(req) {
            if (internalRequestWhitelist) {
                return internalRequestWhitelist.test(req.uri.toString());
            }
            return false;
        }

        return {
            prepareRequest: function(restbase, req) {
                if (isInternalRequest(req)) {
                    rbUtil.copyForwardedHeaders(restbase, req, ['cookie', 'x-forwarded-for']);
                }
            },
            checkPermissions: function(restbase, req, permDefinitions) {
                // First filter permissions applicable to the current method
                var permissions = [];
                permDefinitions.forEach(function(perm) {
                    if (!perm.method || perm.method === req.method) {
                        permissions.push(perm.value);
                    }
                });

                // If nothing is applicable to the current method - skip the check
                if (permissions.length === 0) {
                    return P.resolve();
                }

                var checkReq = {
                    uri: new URI([req.params.domain, 'sys', 'action', 'query']),
                    method: 'post',
                    body: {
                        meta: 'userinfo',
                        uiprop: 'rights'
                    }
                };
                return restbase.post(checkReq)
                .then(function(userInfo) {
                    if (userInfo.rights && Array.isArray(userInfo.rights)) {
                        permissions.forEach(function(perm) {
                            if (userInfo.rights.indexOf(perm) < 0) {
                                throw new rbUtil.HTTPError({
                                    status: 401,
                                    body: {
                                        type: 'unauthorized',
                                        title: 'Not authorized to access the resource',
                                        description: 'Need permission ' + perm
                                    }
                                });
                            }
                        });
                    } else {
                        throw new rbUtil.HTTPError({
                            status: 400,
                            body: {
                                type: 'invalid_request',
                                title: 'Failed to check permissions for the request'
                            }
                        });
                    }
                });
            }
        };
    },
    header_match: function(definition) {
        var errorMessage = definition['x-error-message']
            || 'This client is not allowed to use the endpoint';
        var whitelistMap = {};
        Object.keys(definition['x-whitelists']).forEach(function(whitelistName) {
            whitelistMap[whitelistName]
                = constructInternalRequestRegex(definition['x-whitelists'][whitelistName]);
        });

        return {
            prepareRequest: function() {
            },
            checkPermissions: function(restbase, req, permissions) {
                if (restbase._rootReq.uri === '#internal-startup') {
                    // Skip a check on requests made by RESTBase during startup
                    return;
                }

                permissions.forEach(function(requirementDefinition) {
                    // Check if requirement is limited to some method
                    if (requirementDefinition.method
                            && requirementDefinition.method !== req.method) {
                        return;
                    }

                    var headerMatchRequirement = requirementDefinition.value;
                    var headerName = headerMatchRequirement.header;
                    var headerValue = req.headers && req.headers[headerName]
                            || restbase._rootReq.headers && restbase._rootReq.headers[headerName];

                    headerMatchRequirement.patterns.forEach(function(patternName) {
                        if (!whitelistMap[patternName]) {
                            throw new Error('Invalid spec. ' +
                            'Unknown client ip whitelist name: ' + patternName);
                        }

                        if (!whitelistMap[patternName].test(headerValue)) {
                            throw new rbUtil.HTTPError({
                                status: 403,
                                body: {
                                    type: 'forbidden',
                                    title: 'Access to resource denied',
                                    description: errorMessage
                                }
                            });
                        }
                    });
                });
            }
        };
    }
};

function AuthService(spec) {
    var self = this;
    if (spec.constructor === AuthService) {
        // child instance creation, copy over values
        var parent = spec;
        self.spec = parent.spec;
        self.securityRequirements = {};
        Object.keys(parent.securityRequirements).forEach(function(reqName) {
            self.securityRequirements[reqName] = new Set(parent.securityRequirements[reqName]);
        });
        self.securityDefinitions = parent.securityDefinitions;
    } else {
        self.spec = spec;
        self.securityRequirements = {};
        self.securityDefinitions = {};
        Object.keys(spec.securityDefinitions).forEach(function(name) {
            var creator = securityDefinitionCreators[name];
            if (!creator) {
                throw new Error('Unknown security requirement type: ' + name);
            }
            self.securityDefinitions[name] = creator(spec.securityDefinitions[name]);
        });
    }
}

/**
 * Different security requirement objects could be collected
 * along the path with different required permissions.
 *
 * Here we iterate over objects and join permissions for duplicated types
 * of checks
 *
 * @param requirements {Array} of security requirement objects.
 * @return {Object} a collection of joined security requirements
 */
AuthService.prototype.addRequirements = function(requirements) {
    var self = this;
    requirements.forEach(function(permObj) {
        var names = Object.keys(permObj.value);
        if (names.length !== 1) {
            throw new Error('Invalid security requirement object: ' + JSON.stringify(permObj));
        }
        var name = names[0];
        if (!self.securityRequirements[name]) {
            self.securityRequirements[name] = new Set(permObj.value[name].map(function(perm) {
                return {
                    value: perm,
                    method: permObj.method
                };
            }));
        } else {
            permObj.value[name].forEach(function(perm) {
                self.securityRequirements[name].add({
                    value: perm,
                    method: permObj.method
                });
            });
        }
    });
};


/**
 * Checks against MW api if all the required permissions are present.
 * In case some of the permissions are absent - throws 401 Unauthorized.
 * In case failed to get permisisons for MW API throws 400 Bad Request.
 *
 * @param restbase restbase instance to use
 * @param req original request
 */
AuthService.prototype.checkPermissions = function(restbase, req) {
    var self = this;
    return P.all(Object.keys(self.securityRequirements).map(function(requirementName) {
        var checker = self.securityDefinitions[requirementName];
        if (!checker) {
            throw new Error('Unknown security requirement name: ' + requirementName);
        }
        return checker.checkPermissions(restbase, req, self.securityRequirements[requirementName]);
    }));
};

/**
 * Prepares a request according to all security requirement types.
 * For example, for mediawiki_auth type is forwards cookies to internal
 * services.
 *
 * @param restbase current restbase instance
 * @param req request that would be modified
 */
AuthService.prototype.prepareRequest = function(restbase, req) {
    var self = this;
    Object.keys(self.securityRequirements).map(function(requirementName) {
        var checker = self.securityDefinitions[requirementName];
        if (!checker) {
            throw new Error('Unknown security requirement name: ' + requirementName);
        }
        checker.prepareRequest(restbase, req);
    });
};

module.exports = AuthService;