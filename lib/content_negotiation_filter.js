"use strict";

const HyperSwitch = require('hyperswitch');
const semver = require('semver');
const HTTPError = HyperSwitch.HTTPError;
const URI = HyperSwitch.URI;
const mwUtil = require('./mwUtil');

module.exports = (hyper, req, next, options, specInfo) => {
    const rp = req.params;
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
    if  (!requestedVersion) {
        // 1. Lack of accept header
        // 2. Malformed accept header
        // 3. False-positive is possible in case of
        // content-type mismatch, not just version.
        return next(hyper, req);
    }
    // We ignore the patch version, so if it's specified, replace it with 0
    requestedVersion = requestedVersion.replace(/\d+$/, '0');
    return next(hyper, req)
    .then((htmlRes) => {
        const storedVersion =
            mwUtil.extractHTMLProfileVersion(htmlRes.headers['content-type']);
        if (!storedVersion) {
            // TODO: This can happen if sections are requested;
            // Think what to do with that.
            // If it's not the sections - something is very wrong on our side.
            return htmlRes;
        }

        if (semver.satisfies(storedVersion, requestedVersion)) {
            // Nothing to do
            return htmlRes;
        }

        if (semver.gt(requestedVersion, storedVersion)) {
            // The request for the a greater semver version of the content!
            // Try repeating the request with no-cache.
            req.headers['cache-control'] = 'no-cache';
            return next(hyper, req)
            .then((newRes) => {
                const newVersion =
                    mwUtil.extractHTMLProfileVersion(newRes.headers['content-type']);
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

        // The version is less then we expected - downgrade.
        return hyper.post({
            uri: new URI([rp.domain, 'sys', 'parsoid', 'transform', 'html', 'to', 'html']),
            headers: {
                'content-type': 'application/json',
                'accept': req.headers.accept
            },
            body: {
                original: {
                    html: {
                        headers: htmlRes.headers,
                        body: htmlRes.body.toString()
                    },
                    'data-parsoid': {
                        body: { ids: {} }
                    }
                }
            }
        })
        .then((res) => {
            // Parsoid transformation doesn't know about our caching policies
            // or additional headers RESTBase sets, so merge headers from the original
            // and important headers from the transformation.
            const resHeaders = res.headers;
            res.headers = htmlRes.headers;
            res.headers.vary = resHeaders.vary;
            res.headers['content-type'] = resHeaders['content-type'];
            return res;
        });
    });

};
