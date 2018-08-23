"use strict";

const HyperSwitch = require('hyperswitch');
const semver = require('semver');
const HTTPError = HyperSwitch.HTTPError;
const mwUtil = require('./mwUtil');

module.exports = (hyper, req, next, options, specInfo) => {
    if (!mwUtil.isHTMLRoute(specInfo.path)) {
        // The filter is  only supported on HTML routes,
        // but don't punish the client for our own mistake, just log an error.
        hyper.logger.log('error/configuration',
            `Content negotiation filter is not supported on ${specInfo.path}`);
        return next(hyper, req);
    }

    if (mwUtil.isNoCacheRequest(req)) {
        // Ignore for the no-cache requests.
        return next(hyper, req);
    }

    let requestedVersion = mwUtil.extractHTMLProfileVersion(req.headers.accept);
    // TODO: This can happen in many different cases, think how to properly candle it.
    if  (!requestedVersion) {
        // 1. Lack of accept header
        // 2. Malformed accept header
        // 3. False-positive is possible in case of
        // content-type mismatch, not just version.
        return next(hyper, req);
    }
    // We ignore the patch version, so if it's specified, replace it with 'x'
    requestedVersion = requestedVersion.replace(/\d+$/, 'x');
    return next(hyper, req)
    .then((res) => {
        const storedVersion =
            mwUtil.extractHTMLProfileVersion(res.headers['content-type']);
        if (!storedVersion) {
            // TODO: This can happen if sections are requested;
            // Think what to do with that.
            // If it's not the sections - something is very wrong on our side.
            return res;
        }

        if (semver.satisfies(storedVersion, requestedVersion)) {
            // Nothing to do
            return res;
        }

        if (semver.gt(requestedVersion, storedVersion)) {
            // The request for the a greater semver version of the content!
            // Try repeating the request with no-cache.
            req.headers['cache-control'] = 'no-cache';
            return next(hyper, req)
            .then((newRes) => {
                const newVersion =
                    mwUtil.extractHTMLProfileVersion(newRes.headers['content-type']);

                // We tried, so no accept the minor semver version different from requested.
                // TODO: maybe log?
                const relaxedRequestedVersion = requestedVersion.replace(/.d+\.x$/, 'x.x');
                if (semver.satisfies(newVersion, relaxedRequestedVersion))  {
                    return newRes;
                }

                throw new HTTPError({
                    status: 406,
                    body: {
                        message: 'Failed to provide requested major version',
                        expected: requestedVersion,
                        received: newVersion
                    }
                });
            });
        }

        // The version is less then we expected - downgrade!
        // TODO: Call parsoid to downgrade the version.

        return res;
    });

};
