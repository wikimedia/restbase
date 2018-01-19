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
            lead: [rp.domain, 'sys', 'mobile_bucket', 'lead', rp.title],
            remaining: [rp.domain, 'sys', 'mobile_bucket', 'remaining', rp.title],
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

        const fetchPath = [rp.domain, 'sys', 'mobile_bucket', part, rp.title];
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
        return mwUtils.getSiteInfo(hyper, req)
        .then((siteInfo) => {
            const prefix = `${siteInfo.baseUri}/page/mobile-sections`.replace(/^https?:/, '');
            const title = encodeURIComponent(rp.title);
            const postfixes = ['', '-lead', '-remaining'];
            let purgeEvents = postfixes.map(postfix => ({
                meta: {
                    uri: `${prefix}${postfix}/${title}/${revision}`
                }
            }));

            if (purgeLatest) {
                purgeEvents = purgeEvents.concat(postfixes.map(postfix => ({
                    meta: {
                        uri: `${prefix}${postfix}/${title}`
                    },
                    tags: [ `mobile-sections${postfix}` ]
                })));
            }

            return hyper.post({
                uri: new URI([rp.domain, 'sys', 'events', '']),
                body: purgeEvents
            })
            .catch({ status: 404 }, () => {
            });
        });
    }

    _fetchFromMCSAndStore(hyper, req) {
        const rp = req.params;
        let serviceURI = `${this._options.host}/${rp.domain}/v1/page/mobile-sections`;
        serviceURI += `/${encodeURIComponent(rp.title)}`;
        if (rp.revision) {
            serviceURI += `/${rp.revision}`;
        }

        return hyper.get({
            uri: new URI(serviceURI)
        })
        .then((res) => {
            return hyper.put({
                uri: new URI([rp.domain, 'sys', 'mobile_bucket', 'all', rp.title,
                    res.body.lead.revision]),
                body: {
                    lead: {
                        headers: res.headers,
                        body: res.body.lead
                    },
                    remaining: {
                        headers: res.headers,
                        body: res.body.remaining
                    }
                }
            })
            .tap(() =>
                this._purgeURIs(hyper, req, res.body.lead.revision, true))
            // TODO: This means we never store older revisions for mobile!
            // Need to add the fallback when mobile-references get implemented!
            .catch({ status: 412 }, () =>
                // 412 means that it's an older revision
                this._purgeURIs(hyper, req, res.body.lead.revision, false))
            .thenReturn(res);
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
                uri: '/{domain}/sys/mobile_bucket/',
            }
        ]
    };
};
