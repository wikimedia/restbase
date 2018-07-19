"use strict";

const mwUtil = require('./mwUtil');

module.exports = function normalizeHeaders(hyper, req, next) {
    if (mwUtil.isNoCacheRequest(req)) {
        req.headers['cache-control'] = 'no-cache';
    } else if (req.headers && req.headers['cache-control']) {
        delete req.headers['cache-control'];
    }
    return next(hyper, req);
};
