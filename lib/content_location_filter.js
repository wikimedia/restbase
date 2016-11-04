"use strict";

const HyperSwitch = require('hyperswitch');
const URI = HyperSwitch.URI;
const mwUtil = require('./mwUtil');
const path = require('path');
const P = require('bluebird');

function isAbsoluteRedirect(location) {
    return /^https?:/.test(location);
}

function resolveRelativeRedirect(hyper, req, res) {
    return mwUtil.getSiteInfo(hyper, req)
    .then((siteInfo) => {
        const pathArr = req.uri.path.slice(2).map(encodeURIComponent);
        pathArr.push('..');
        pathArr.push(res.headers.location);
        return `${siteInfo.baseUri}/${path.join.apply(path, pathArr)}`;
    });
}

function resolvedRedirectResponse(hyper, req, res) {
    let getContentURI;
    if (isAbsoluteRedirect(res.headers.location)) {
        getContentURI = P.resolve(res.headers.location);
    } else {
        getContentURI = resolveRelativeRedirect(hyper, req, res);
    }
    return getContentURI.then((contentURI) => hyper.request({
        method: req.method,
        uri: new URI(contentURI)
    }))
    .tap((res) => {
        res.headers = res.headers || {};
        res.headers['cache-control'] = 'no-cache';
        res.headers.vary = res.headers.vary ? `${res.headers.vary}, origin` : 'origin';
    });
}

module.exports = (hyper, req, next) => {
    if (req.method !== 'get') {
        return next(hyper, req);
    } else {
        const attachLocation = (res) => {
            res.headers = res.headers || {};
            if (res.status === 301 || res.status === 302) {
                if (mwUtil.isCrossOrigin(req)) {
                    return resolvedRedirectResponse(hyper, req, res);
                }
                return res;
            }
            return mwUtil.getSiteInfo(hyper, req)
            .then((siteInfo) => {
                Object.assign(res.headers, {
                    'content-location': siteInfo.baseUri
                    + new URI(req.uri.path.slice(2))
                    + mwUtil.getQueryString(req)
                });
                return res;
            });
        };

        return next(hyper, req)
        .then(attachLocation, attachLocation)
        .tap((res) => {
            if (res.status >= 400) {
                throw res;
            }
        });
    }
};
