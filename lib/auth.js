"use strict";

var P       = require('bluebird');
var rbUtil  = require('./rbUtil');
var URI     = require('swagger-router').URI;

var auth = {};


/**
 * Different security requirement objects could be collected
 * along the path with different required permissions.
 *
 * Here we iterate over objects and join permissions for duplicated types
 * of checks
 *
 * @param permissions {Array} of security requirement objects.
 * @param existing {Object} an existing collection of security requirements
 * @return {Object} a collection of joined security requirements
 */
auth.joinPermissions = function(permissions, existing) {
    var result = {};
    if (existing) {
        Object.keys(existing).forEach(function(permKey) {
            result[permKey] = new Set(existing[permKey]);
        });
    }
    permissions.forEach(function(permObj) {
        var names = Object.keys(permObj);
        if (names.length !== 1) {
            throw new Error('Invalid security requirement object: ' + JSON.stringify(permObj));
        }
        var name = names[0];
        if (!result[name]) {
            result[name] = new Set(permObj[name]);
        } else {
            permObj[name].forEach(function(perm) { result[name].add(perm); });
        }
    });
    return result;
};

/**
 * A collection of known security requirement object checkers.
 * Identified by the security requirement name, and contains a function
 * that takes RESTBase, request and a Set of rights as an input and verifies
 * that all rights are present.
 */
auth.checkers = {};
auth.checkers.mediawiki_auth = function(restbase, req, permissions) {
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
};

/**
 * Checks against MW api if all the required permissions are present.
 * In case some of the permissions are absent - throws 401 Unauthorized.
 * In case failed to get permisisons for MW API throws 400 Bad Request.
 *
 * @param restbase restbase instance to use
 * @param req original request
 */
auth.checkPermissions = function(restbase, req) {
    return P.all(Object.keys(restbase._accessRestrictions).map(function(requirementName) {
        var check = auth.checkers[requirementName];
        if (!check) {
            throw new Error('Unknown security requirement name: ' + requirementName);
        }
        return check(restbase, req, restbase._accessRestrictions[requirementName]);
    }));
};

module.exports = auth;