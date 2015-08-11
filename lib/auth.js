"use strict";

var P       = require('bluebird');
var rbUtil  = require('./rbUtil');
var URI     = require('swagger-router').URI;

var auth = {};

/**
 * Checks against MW api if all the required permissions are present.
 * In case some of the permissions are absent - throws 401 Unauthorized.
 * In case failed to get permisisons for MW API throws 400 Bad Request.
 *
 * @param restbase restbase instance to use
 * @param req original request
 * @param permissions required permissions
 */
auth.checkPermissions = function(restbase, req, permissions) {
    var checkReq = {
        uri: new URI([req.params.domain, 'sys', 'action', 'query']),
        method: 'post',
        body: {
            meta: 'userinfo',
            uiprop: 'rights'
        },
        headers: {
            'x-internal-request': true
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

module.exports = auth;