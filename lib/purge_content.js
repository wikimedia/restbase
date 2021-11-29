'use strict';

const mwUtil = require('./mwUtil');

module.exports = (hyper, req, next, options) => {
    const startTime = Date.parse(options.start_time);
    const endTime = Date.parse(options.end_time);

    return next(hyper, req)
        .then((res) => {
            if (!startTime || !endTime) {
                return res;
            }

            let contentTimestamp;
            try {
                contentTimestamp = mwUtil.extractDateFromEtag(res.headers.etag);
            } catch (error) {
                return res;
            }

            if (!contentTimestamp || contentTimestamp < startTime || contentTimestamp > endTime) {
                return res;
            }

            if (mwUtil.isNoCacheRequest(req)) {
                return res;
            }

            req.headers['cache-control'] = 'no-cache';
            return next(hyper, req);
        });
};
