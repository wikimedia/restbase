'use strict';

const HyperSwitch = require('hyperswitch');
const URI = HyperSwitch.URI;
const mwUtils = require('../lib/mwUtil');

const spec = HyperSwitch.utils.loadSpec(`${__dirname}/mobileapps.yaml`);

const BUCKET_NAME = 'mobile-sections';

class MobileApps {
    constructor(options) {
        this._options = options;
    }

    _injectCacheControl(res) {
        res.headers = res.headers || {};
        res.headers['cache-control'] = this._options.response_cache_control;
        return res;
    }

    _injectDeprecationHeaders(res) {
        // Sunset HTTP header spec:
        // https://www.rfc-editor.org/rfc/rfc8594.html
        res.headers = res.headers || {};
        res.headers.sunset = 'Sat, 01 Jul 2023 00:00:00 GMT';
        return res;
    }

    getSections(hyper, req) {
        if (mwUtils.isNoCacheRequest(req)) {
            return this._fetchFromMCSAndStore(hyper, req)
            .tap(this._injectCacheControl.bind(this));
        }

        const rp = req.params;
        return hyper.get({
            uri: new URI([rp.domain, 'sys', 'key_value', BUCKET_NAME, rp.title])
        })
        .then((res) => {
            if (!rp.revision ||
                `${mwUtils.parseETag(res.headers.etag).rev}` === `${rp.revision}`) {
                return res;
            }
            return this._fetchFromMCS(hyper, req);
        })
        .catch({ status: 404 }, () => this._fetchFromMCSAndStore(hyper, req))
        .tap(this._injectDeprecationHeaders.bind(this))
        .tap(this._injectCacheControl.bind(this));
    }

    getPart(part, hyper, req) {
        return this.getSections(hyper, req)
        .then((res) => {
            return {
                status: res.status,
                headers: res.headers,
                body: res.body[part]
            };
        });
    }

    _purgeURIs(hyper, req, revision, purgeLatest) {
        const rp = req.params;
        return mwUtils.getSiteInfo(hyper, req)
        .then((siteInfo) => {
            const prefix = `${siteInfo.baseUri}/page/mobile-sections`.replace(/^https?:/, '');
            const title = encodeURIComponent(rp.title);
            const postfixes = ['', '-lead', '-remaining'];
            let purgeEvents = postfixes.map((postfix) => ({
                meta: {
                    uri: `${prefix}${postfix}/${title}/${revision}`
                }
            }));

            if (purgeLatest) {
                purgeEvents = purgeEvents.concat(postfixes.map((postfix) => ({
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

    _fetchFromMCS(hyper, req) {
        const rp = req.params;
        let serviceURI = `${this._options.host}/${rp.domain}/v1/page/mobile-sections`;
        serviceURI += `/${encodeURIComponent(rp.title)}`;
        if (rp.revision) {
            serviceURI += `/${rp.revision}`;
        }

        return hyper.get({
            uri: new URI(serviceURI),
            headers: {
                'accept-language': req.headers['accept-language']
            }
        });
    }

    _fetchFromMCSAndStore(hyper, req) {
        const rp = req.params;

        return this._fetchFromMCS(hyper, req)
        .then((res) => {
            if (mwUtils.isNoStoreRequest(req)) {
                return res;
            }
            return hyper.put({
                uri: new URI([rp.domain, 'sys', 'key_value', BUCKET_NAME, rp.title]),
                headers: {
                    'content-type': 'application/octet-stream',
                    'x-store-etag': res.headers.etag,
                    'x-store-content-language': res.headers['content-language'],
                    'x-store-content-type': res.headers['content-type'],
                    'x-store-vary': res.headers.vary
                },
                body: Buffer.from(JSON.stringify(res.body))
            })
            .tap(() => this._purgeURIs(hyper, req, res.body.lead.revision, true))
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
            getSectionsWithRevision: mobileApps.getSections.bind(mobileApps),
            getSectionsLead: mobileApps.getPart.bind(mobileApps, 'lead'),
            getSectionsLeadWithRevision: mobileApps.getPart.bind(mobileApps, 'lead'),
            getSectionsRemaining: mobileApps.getPart.bind(mobileApps, 'remaining'),
            getSectionsRemainingWithRevision: mobileApps.getPart.bind(mobileApps, 'remaining')
        },
        resources: [
            { uri: `/{domain}/sys/key_value/${BUCKET_NAME}` }
        ]
    };
};
