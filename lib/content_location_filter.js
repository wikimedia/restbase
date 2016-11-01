"use strict";

const HyperSwitch = require('hyperswitch');
const Template = HyperSwitch.Template;
const URI = HyperSwitch.URI;
const mwUtil = require('./mwUtil');

let basePathTemplate;

module.exports = (hyper, req, next, options) => {
    basePathTemplate = basePathTemplate || new Template({
        uri: options.templates.base_uri_template
    });
    if (req.method !== 'get') {
        return next(hyper, req);
    } else {
        const baseUri = basePathTemplate.expand({
            request: req
        }).uri;
        const attachLocation = (res) => {
            if (res.status !== 301 && res.status !== 302) {
                res.headers = res.headers || {};
                Object.assign(res.headers, {
                    'content-location': baseUri
                        + new URI(req.uri.path.slice(2))
                        + mwUtil.getQueryString(req)
                });
            }
            if (res.status >= 400) {
                throw res;
            }
            return res;
        };
        return next(hyper, req).then(attachLocation).catch(attachLocation);
    }
};
