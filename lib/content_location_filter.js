"use strict";

const HyperSwitch = require('hyperswitch');
const URI = HyperSwitch.URI;
const mwUtil = require('./mwUtil');

module.exports = (hyper, req, next) => {
    if (req.method !== 'get') {
        return next(hyper, req);
    } else {
        const attachLocation = (res) => {
            res.headers = res.headers || {};
            if (res.status === 301 || res.status === 302
                    || res.headers['content-location']) {
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
