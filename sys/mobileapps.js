"use strict";

const P = require('bluebird');
const HyperSwitch = require('hyperswitch');
const URI = HyperSwitch.URI;
const mwUtils = require('../lib/mwUtil');

const spec = HyperSwitch.utils.loadSpec(`${__dirname}/mobileapps.yaml`);

class MobileApps {
    constructor(options) {
        this._options = options;
    }

    getSections(hyper, req) {
        if (mwUtils.isNoCacheRequest(req)) {
            return this._fetchFromMCSAndStore(hyper, req);
        }

        const rp = req.params;
        const fetchPaths = {
            lead: [rp.domain, 'sys', 'key_rev_value',
                'mobile-sections-lead', rp.title],
            remaining: [rp.domain, 'sys', 'key_rev_value',
                'mobile-sections-remaining', rp.title]
        };
        if (rp.revision) {
            fetchPaths.lead.push(rp.revision);
            fetchPaths.remaining.push(rp.revision);
        }
        return P.join(
            hyper.get({
                uri: new URI(fetchPaths.lead),
            }),
            hyper.get({
                uri: new URI(fetchPaths.remaining),
            })
        ).spread((lead, remaining) => ({
            status: 200,
            headers: lead.headers,
            body: {
                lead: lead.body,
                remaining: remaining.body
            }
        }))
        .catch({ status: 404 }, () => this._fetchFromMCSAndStore(hyper, req));
    }

    getPart(part, hyper, req) {
        const rp = req.params;
        const fetchAndReturnPart = () => this._fetchFromMCSAndStore(hyper, req)
        .then((res) => {
            return {
                status: 200,
                headers: req.headers,
                body: res.body[part]
            };
        });

        if (mwUtils.isNoCacheRequest(req)) {
            return fetchAndReturnPart();
        }

        const fetchPath = [rp.domain, 'sys', 'key_rev_value',
            `mobile-sections-${part}`, rp.title];
        if (rp.revision) {
            fetchPath.push(rp.revision);
        }

        return hyper.get({
            uri: new URI(fetchPath),
        })
        .catch({ status: 404 }, fetchAndReturnPart);
    }

    _purgeURIs(hyper, req, revision, purgeLatest) {
        const rp = req.params;
        const prefix = `//${rp.domain}/api/rest_v1/page/mobile-sections`;
        const title = encodeURIComponent(rp.title);
        let purgeEvents = [
            {
                meta: {
                    uri: `${prefix}/${title}/${revision}`
                }
            },
            {
                meta: {
                    uri: `${prefix}-lead/${title}/${revision}`
                }
            },
            {
                meta: {
                    uri: `${prefix}-remaining/${title}/${revision}`
                }
            }
        ];
        if (purgeLatest) {
            purgeEvents = purgeEvents.concat([
                {
                    meta: {
                        uri: `${prefix}/${title}`
                    }
                },
                {
                    meta: {
                        uri: `${prefix}-lead/${title}`
                    }
                },
                {
                    meta: {
                        uri: `${prefix}-remaining/${title}`
                    }
                },

            ]);
        }

        return hyper.post({
            uri: new URI([rp.domain, 'sys', 'events', '']),
            body: purgeEvents
        })
        .catch({ status: 404 }, () => {
        });
    }

    _fetchFromMCSAndStore(hyper, req) {
        const rp = req.params;
        let serviceURI = `${this._options.host}/${rp.domain}/v1/page/mobile-sections`;
        serviceURI += `/${encodeURIComponent(rp.title)}`;
        if (rp.revision) {
            serviceURI += `/${rp.revision}`;
        }

        const requests = {
            newContent: hyper.get({
                uri: new URI(serviceURI)
            })
        };

        if (rp.revision) {
            // This might be a request to the old revision and we don't want
            // to issue a purge for the latest revision nor store it in the
            // key_rev bucket, so check if it's indeed the latest
            requests.latestRev = hyper.get({
                uri: new URI([rp.domain, 'sys', 'key_rev_value',
                    'mobile-sections-lead', rp.title])
            })
            .then((res) => res.body.revision)
            .catch({ status: 404 }, () => {
                // We have no revisions for this title, so it's certainly latest.
                return -1;
            });
        } else {
            requests.latestRev = P.resolve(-1);
        }

        const shouldStoreNewRev = (latestRev) => !rp.revision || rp.revision >= latestRev;

        return P.props(requests)
        .then((res) => {
            const newContent = res.newContent;
            let storeRequests = P.resolve();
            if (shouldStoreNewRev(res.latestRev)) {
                storeRequests = P.join(
                    hyper.put({
                        uri: new URI([rp.domain, 'sys', 'key_rev_value',
                            'mobile-sections-lead', rp.title,
                            newContent.body.lead.revision]),
                        headers: newContent.headers,
                        body: newContent.body.lead
                    }),
                    hyper.put({
                        uri: new URI([rp.domain, 'sys', 'key_rev_value',
                            'mobile-sections-remaining', rp.title,
                            newContent.body.lead.revision]),
                        headers: newContent.headers,
                        body: newContent.body.remaining
                    }));
            }
            return storeRequests
            .tap(() => this._purgeURIs(hyper, req,
                newContent.body.lead.revision, shouldStoreNewRev(res.latestRev)))
            .thenReturn(newContent);
        });
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
        },
        resources: [
            {
                uri: '/{domain}/sys/key_rev_value/mobile-sections-lead',
                body: {
                    version: 4,
                    revisionRetentionPolicy: {
                        type: 'latest_hash',
                        count: 1,
                        grace_ttl: 1
                    },
                    valueType: 'json',
                    updates: {
                        pattern: 'timeseries'
                    }
                }
            },
            {
                uri: '/{domain}/sys/key_rev_value/mobile-sections-remaining',
                body: {
                    version: 4,
                    revisionRetentionPolicy: {
                        type: 'latest_hash',
                        count: 1,
                        grace_ttl: 1
                    },
                    valueType: 'json',
                    updates: {
                        pattern: 'timeseries'
                    }
                }
            },
        ]
    };
};
