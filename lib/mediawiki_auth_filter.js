'use strict';

const HyperSwitch = require('hyperswitch');
const HTTPError = HyperSwitch.HTTPError;
const URI = HyperSwitch.URI;

function copyForwardedHeaders(req, rootReq, headersLins) {
    if (rootReq.headers) {
        req.headers = req.headers || {};
        headersLins.forEach((header) => {
            if (!req.headers[header] && rootReq.headers[header]) {
                req.headers[header] = rootReq.headers[header];
            }
        });
    }
    return req;
}

function checkPermissions(hyper, req, permissions) {
    return hyper.post({
        uri: new URI([req.params.domain, 'sys', 'action', 'query']),
        method: 'post',
        body: {
            meta: 'userinfo',
            uiprop: 'rights'
        }
    })
    .then((userInfo) => {
        userInfo = userInfo.body;
        if (userInfo && userInfo.rights && Array.isArray(userInfo.rights)) {
            permissions.forEach((perm) => {
                if (userInfo.rights.indexOf(perm) < 0) {
                    throw new HTTPError({
                        status: 401,
                        body: {
                            type: 'unauthorized',
                            title: 'Not authorized to access the resource',
                            description: `Need permission ${perm}`
                        }
                    });
                }
            });
        } else {
            throw new HTTPError({
                status: 400,
                body: {
                    type: 'bad_request',
                    title: 'Failed to check permissions for the request'
                }
            });
        }
    });
}

module.exports = (hyper, req, next, options) => {
    if (hyper._isSysRequest(req)) {
        return next(hyper, req);
    }

    copyForwardedHeaders(hyper.ctx, req,
        ['cookie', 'x-forwarded-for', 'x-client-ip']);

    if (!options.permissions || !options.permissions.length) {
        return next(hyper, req);
    }

    return checkPermissions(hyper, req, options.permissions)
    .then(() => next(hyper, req))
    .then((res) => {
        if (res.headers) {
            res.headers['cache-control'] = 'no-cache';
        }
        return res;
    });
};
