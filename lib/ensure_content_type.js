'use strict';

var cType = require('content-type');
var mwUtil = require('./mwUtil');

// Utility function to split path & version suffix from a profile parameter.
function splitProfile(profile) {
    var match = /^(.*)\/([0-9\.]+)$/.exec(profile);
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
    .then(function(res) {
        if (res.headers && res.headers['content-type'] !== expectedContentType) {
            // Parse the expected & response content type, and compare
            // profiles.
            var expectedProfile = cType.parse(expectedContentType).parameters.profile;
            var actualProfile = cType.parse(res.headers['content-type']).parameters.profile;
            if (actualProfile && expectedProfile && actualProfile !== expectedProfile) {
                // Check if actual content type is newer than the spec
                var actualProfileParts = splitProfile(actualProfile);
                var expectedProfileParts = splitProfile(expectedProfile);
                if (actualProfileParts.path === expectedProfileParts.path
                        && actualProfileParts.version > expectedProfileParts.version) {
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

                // Do not re-render if the response was only rendered within
                // the last two minutes.
                if (res.headers.etag
                        && Date.now() - mwUtil.extractDateFromEtag(res.headers.etag) < 120000) {
                    return res;
                }

                // Re-try request with no-cache header
                if (!mwUtil.isNoCacheRequest(req)) {
                    req.headers['cache-control'] = 'no-cache';
                    return checkContentType(hyper, req, next,
                            expectedContentType, next(hyper, req));
                } else {
                    // Log issue
                    hyper.log('warn/content-type/upgrade_failed', {
                        msg: 'Could not update the content-type',
                        expected: expectedContentType,
                        actual: res.headers['content-type']
                    });
                    // Limit response caching to a few seconds
                    res.headers['cache-control'] = 'max-age=10, s-maxage=10';
                }
            }
        }

        // Default: Just return.
        return res;
    });
}


module.exports = function(hyper, req, next, options, specInfo) {
    var rp = req.params;
    var produces = specInfo.spec.produces;
    var expectedContentType = Array.isArray(produces) && produces[0];
    var responsePromise = next(hyper, req);
    if (expectedContentType) {
        // Found a content type. Ensure that we return the latest profile.
        return checkContentType(hyper, req, next, expectedContentType, responsePromise);
    } else {
        return responsePromise;
    }
};
