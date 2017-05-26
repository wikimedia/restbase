"use strict";

const cType = require('content-type');
const semver = require('semver');

const TAGS_MATCH = /<\/?[a-zA-Z][\w-]*(?:\s+[a-zA-Z_-]+(?:=(?:"[^"]*"|'[^']*'))?)*\s*\/?>/g;
const LATEST_1_VERSION = '1.1.2';

function splitProfile(profile) {
    const match = /^(.*)\/([0-9.]+)$/.exec(profile);
    return {
        path: match[1],
        version: match[2],
    };
}

module.exports = (hyper, req, next) => {
    let acceptVersion;
    if (req.headers.accept) {
        let parsedCType;
        try {
            parsedCType = cType.parse(req.headers.accept);
        } catch (e) {}
        acceptVersion = parsedCType && parsedCType.parameters
            && parsedCType.parameters.profile
            && splitProfile(parsedCType.parameters.profile).version;
    }
    if (!acceptVersion || !semver.valid(acceptVersion)) {
        // Return the 1.1.2 if the 'Accept' header is not provided
        // for compatibility with older clients.
        // TODO: remove eventually and return the latest content-type by default
        // Normally we would set the latest version here
        acceptVersion = LATEST_1_VERSION;
    }

    return next(hyper, req)
    .then((res) => {
        if (semver.lt(acceptVersion, '2.0.0')) {
            res.body.extract = res.body.extract.replace(TAGS_MATCH, '');
            res.headers['content-type'] = res.headers['content-type']
                .replace(/[0-9.]+"$/, `${LATEST_1_VERSION}"`);
        }

        res.headers.vary = 'accept';
        return res;
    });
};

