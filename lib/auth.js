"use strict";

var P       = require('bluebird');
var rbUtil  = require('./rbUtil');
var URI     = require('swagger-router').URI;

var auth = {};

auth.checkPermissions = function(restbase, req, permissions) {
    var checkReq = {
        uri: new URI([req.params.domain,'sys','action','userinfo']),
        method: 'post',
        body: {
            meta: 'userinfo',
            uiprop: 'rights'
        }
    };
    rbUtil.copyForwardedHeaders(restbase, checkReq);
    return restbase.post(checkReq)
    .then(function(userInfo) {
        var accessAllowed;
        var absentPermissions = [];
        if (userInfo.rights && Array.isArray(userInfo.rights)) {
            permissions.forEach(function(perm) {
                if (userInfo.rights.indexOf(perm) < 0) {
                    absentPermissions.push(perm);
                }
            });
            accessAllowed = absentPermissions.length === 0;
        } else {
            accessAllowed = false;
        }
        if (accessAllowed) {
            return userInfo;
        } else {
            throw new rbUtil.HTTPError({
                status: 401,
                body: {
                    type: 'unauthorized',
                    title: 'Not authorized to access the resource',
                    description: 'Need permissions ' + absentPermissions
                }
            });
        }
    });
};

module.exports = auth;