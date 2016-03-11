"use strict";

/**
 * From a list of uri Regex and values, constructs a regex to check if the
 * request URI is in the white-list.
 */
var CACHE = new Map();
function constructInternalRequestRegex(variants) {
    if (CACHE.has(variants)) {
        return CACHE.get(variants);
    }
    var regex = (variants || []).map(function(regexString) {
        if (/^\/.+\/$/.test(regexString)) {
            return '(:?' + regexString.substring(1, regexString.length - 1) + ')';
        } else {
            // Instead of comparing strings
            return '(:?^'
                + regexString.replace(/[\-\[\]\/\{}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&")
                + '$)';
        }
    }).join('|');
    regex = regex && regex.length > 0 ? new RegExp(regex) : undefined;
    CACHE.set(variants, regex);
    return regex;
}

module.exports = function(hyper, req, next, options) {
    var internalRequestWhitelist
        = constructInternalRequestRegex(options.forward_headers_to);
    var isInternalRequest = function(req) {
        if (internalRequestWhitelist) {
            return internalRequestWhitelist.test(req.uri.toString());
        }
        return false;
    };
    if (hyper.ctx.headers && isInternalRequest(req)) {
        req.headers = req.headers || {};
        Object.keys(hyper.ctx.headers).forEach(function(headerName) {
            req.headers[headerName] = req.headers[headerName] || hyper.ctx.headers[headerName];
        });
    }
    return next(hyper, req);
};