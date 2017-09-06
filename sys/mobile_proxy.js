"use strict";

const P = require('bluebird');
const HyperSwitch = require('hyperswitch');
const URI = HyperSwitch.URI;

const spec = HyperSwitch.utils.loadSpec(`${__dirname}/mobileapps.yaml`);

class MobileApps {
    constructor(options) {
        this._options = options;
    }

    _generateDoubleFetching(hyper, req, oldPath, newPath) {
        return P.join(
            hyper.get({
                uri: new URI(oldPath),
                headers: req.headers
            })
            .catch((e) => {
                hyper.log('error/mobileapps', {
                    message: 'Error fetching old mobile content',
                    error: e
                });
                throw e;
            }),
            hyper.get({
                uri: new URI(newPath),
                headers: req.headers
            })
            .catch((e) => {
                hyper.log('error/mobileapps', {
                    message: 'Error fetching new mobile content',
                    error: e
                });
            })
        )
        .then((results) => {
            const oldBucket = results[0];
            const newBucket = results[1];

            if (oldBucket && newBucket) {
                if (JSON.stringify(oldBucket.body) !== JSON.stringify(newBucket.body)) {
                    hyper.log('error/mobileapps', {
                        message: 'Content mismatch between old and new bucket',
                        old_etag: oldBucket.headers.etag,
                        new_etag: newBucket.headers.etag
                    });
                }
            }

            // TODO: Even more logging!
            return oldBucket || newBucket;
        });
    }

    getSections(hyper, req) {
        const rp = req.params;
        const oldPath = [rp.domain, 'sys', 'mobileapps_old', 'mobile-sections', rp.title];
        if (rp.revision) {
            oldPath.push(rp.revision);
        }
        const newPath = [rp.domain, 'sys', 'mobileapps_new', 'mobile-sections', rp.title];
        if (rp.revision) {
            newPath.push(rp.revision);
        }
        return this._generateDoubleFetching(hyper, req, oldPath, newPath);
    }

    getPart(part, hyper, req) {
        const rp = req.params;
        const oldPath = [rp.domain, 'sys', 'mobileapps_old', `mobile-sections-${part}`, rp.title];
        if (rp.revision) {
            oldPath.push(rp.revision);
        }
        const newPath = [rp.domain, 'sys', 'mobileapps_new', `mobile-sections-${part}`, rp.title];
        if (rp.revision) {
            newPath.push(rp.revision);
        }
        return this._generateDoubleFetching(hyper, req, oldPath, newPath);
    }
}

module.exports = (options) => {
    const mobileApps = new MobileApps(options);

    return {
        spec,
        operations: {
            getSections: mobileApps.getSections.bind(mobileApps),
            getSectionsLead: mobileApps.getPart.bind(mobileApps, 'lead'),
            getSectionsRemaining: mobileApps.getPart.bind(mobileApps, 'remaining')
        }
    };
};
