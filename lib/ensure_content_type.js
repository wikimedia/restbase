'use strict';

const cType = require('content-type');
const mwUtil = require('./mwUtil');

// Utility function to split path & version suffix from a profile parameter.
function splitProfile(profile) {
    const match = /^(.*)\/([0-9.]+)$/.exec(profile);
    return {
        path: match[1],
        version: match[2],
    };
}


/**
 * Simple content type enforcement
 *
 * - Assumes that the first `produces` array entry is the latest.
 * - Repeats request with `no-cache` header set if the content-type does not
 *   match the latest version.
 */

function checkContentType(hyper, req, next, expectedContentType, responsePromise) {
    return responsePromise
    .then((res) => {
        // Do not check or re-render if the response was only rendered within
        // the last two minutes.
        if (res.headers && res.headers.etag
            && Date.now() - mwUtil.extractDateFromEtag(res.headers.etag) < 120000) {
            return res;
        }

        function updateSpecWarning() {
            // Returned content type version is higher than what the
            // spec promises. Log a warning about the need to update the spec.
            hyper.log('warn/content-type/spec_outdated', {
                msg: 'Spec needs update to reflect latest content type.',
                expected: expectedContentType,
                actual: res.headers['content-type']
            });
            // Don't fail the request.
            return res;
        }

        if (res.headers && res.headers['content-type'] !== expectedContentType) {
            // Parse the expected & response content type, and compare profiles.
            const expectedProfile = cType.parse(expectedContentType).parameters.profile;
            const actualProfile = cType.parse(res.headers['content-type']).parameters.profile;

            if (actualProfile && actualProfile !== expectedProfile) {
                if (!expectedProfile) {
                    return updateSpecWarning();
                }
                // Check if actual content type is newer than the spec
                const actualProfileParts = splitProfile(actualProfile);
                const expectedProfileParts = splitProfile(expectedProfile);
                if (actualProfileParts.path === expectedProfileParts.path
                        && actualProfileParts.version > expectedProfileParts.version) {
                    return updateSpecWarning();
                }
            }

            // Re-try request with no-cache header
            if (!mwUtil.isNoCacheRequest(req)) {
                req.headers['cache-control'] = 'no-cache';
                return checkContentType(hyper, req, next, expectedContentType, next(hyper, req));
            } else {
                // Log issue
                hyper.log('warn/content-type/upgrade_failed', {
                    msg: 'Could not update the content-type',
                    expected: expectedContentType,
                    actual: res.headers['content-type']
                });
                // Disable response caching, as we aren't setting a vary
                // either.
                res.headers['cache-control'] = 'max-age=0, s-maxage=0';
            }
        }
        // Default: Just return.
        return res;
    });
}


module.exports = (hyper, req, next, options, specInfo) => {
    const produces = specInfo.spec.produces;
    const expectedContentType = Array.isArray(produces) && produces[0];
    const responsePromise = next(hyper, req);
    if (expectedContentType) {
        // Found a content type. Ensure that we return the latest profile.
        return checkContentType(hyper, req, next, expectedContentType, responsePromise);
    } else {
        return responsePromise;
    }
};
