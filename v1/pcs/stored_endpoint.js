'use strict';

const HyperSwitch = require('hyperswitch');
const URI = HyperSwitch.URI;
const mwUtils = require('../../lib/mwUtil');

class PCSEndpoint {
    constructor(options) {
        this._options = options;
        this._disabled_storage = options.disabled_storage || false;
    }

    _injectCacheControl(res) {
        res.headers = res.headers || {};
        res.headers['cache-control'] = this._options.response_cache_control;
        return res;
    }

    getContent(hyper, req) {
        const startTime = Date.now();
        const rp = req.params;

        // restbase sunset: Make PCS requests passthrough
        // to mobileapps service
        if (this._disabled_storage) {
            return this._fetchFromPCS(hyper, req)
            .tap((res) => {
                res.headers['x-restbase-sunset'] = true;
                this._injectCacheControl.bind(this);
                hyper.metrics.timing([
                    'pcs_getContent_latency',
                    'pcs_getContent_latency_no_storage',
                    `pcs_getContent_latency_${rp.domain}`
                ], startTime);
            });
        }

        if (mwUtils.isNoCacheRequest(req)) {
            return this._fetchFromPCSAndStore(hyper, req)
            .tap(() => {
                this._injectCacheControl.bind(this);
                hyper.metrics.timing([
                    'pcs_getContent_latency',
                    'pcs_getContent_latency_no_cache',
                    `pcs_getContent_latency_${rp.domain}`
                ], startTime);
            });
        }

        return hyper.get({
            uri: new URI([rp.domain, 'sys', 'key_value', this._options.name, rp.title])
        })
        .then((res) => {
            if (!rp.revision ||
                `${mwUtils.parseETag(res.headers.etag).rev}` === `${rp.revision}`) {
                return res;
            }
            return this._fetchFromPCS(hyper, req);
        })
        .catch({ status: 404 }, () => this._fetchFromPCSAndStore(hyper, req))
        .tap(() => {
            this._injectCacheControl.bind(this);
            hyper.metrics.timing([
                'pcs_getContent_latency',
                'pcs_getContent_latency_cached',
                `pcs_getContent_latency_${rp.domain}`
            ], startTime);
        });
    }

    _purgeURIs(hyper, req, revision) {
        const rp = req.params;
        return mwUtils.getSiteInfo(hyper, req)
        .then((siteInfo) => {
            const path = `${siteInfo.baseUri}/page/${this._options.name}`.replace(/^https?:/, '');
            const title = encodeURIComponent(rp.title);
            const purgeEvents = [
                {
                    meta: {
                        uri: `${path}/${title}/${revision}`
                    },
                    tags: ['restbase']
                },
                {
                    meta: {
                        uri: `${path}/${title}`
                    },
                    tags: ['restbase']
                }];

            return hyper.post({
                uri: new URI([rp.domain, 'sys', 'events', '']),
                body: purgeEvents
            })
            .catch({ status: 404 }, () => {
            });
        });
    }

    _fetchFromPCS(hyper, req) {
        const startTime = Date.now();
        const rp = req.params;
        let serviceURI = `${this._options.host}/${rp.domain}/v1/page/${this._options.name}`;
        serviceURI += `/${encodeURIComponent(rp.title)}`;
        if (rp.revision) {
            serviceURI += `/${rp.revision}`;
        }

        return hyper.get({
            uri: new URI(serviceURI),
            headers: {
                'accept-language': req.headers['accept-language']
            }
        }).tap(() => hyper.metrics.timing([
            'pcs_fetch_latency',
            `pcs_fetch_latency_${rp.domain}`
        ], startTime));
    }

    _fetchFromPCSAndStore(hyper, req) {
        const rp = req.params;

        return this._fetchFromPCS(hyper, req)
        .then((res) => {
            if (mwUtils.isNoStoreRequest(req)) {
                return res;
            }
            const revision = mwUtils.parseETag(res.headers.etag).rev;
            let bodyToStore;
            if (/^application\/json.*/.test(res.headers['content-type'])) {
                bodyToStore = Buffer.from(JSON.stringify(res.body));
            } else {
                bodyToStore = Buffer.from(res.body);
            }
            return hyper.put({
                uri: new URI([rp.domain, 'sys', 'key_value', this._options.name, rp.title]),
                headers: {
                    'content-type': 'application/octet-stream',
                    'x-store-etag': res.headers.etag,
                    'x-store-content-language': res.headers['content-language'],
                    'x-store-content-type': res.headers['content-type'],
                    'x-store-vary': res.headers.vary
                },
                body: bodyToStore
            })
            .tap(() => this._purgeURIs(hyper, req, revision))
            .thenReturn(res);
        });
    }
}

module.exports = (options) => {
    if (!options || !options.name) {
        throw new Error('name not specified for PCS endpoint configuration');
    }
    const pcs = new PCSEndpoint(options);
    const spec = HyperSwitch.utils.loadSpec(`${__dirname}/${options.name}.yaml`);
    return {
        spec,
        operations: {
            [`getContent-${options.name}`]: pcs.getContent.bind(pcs),
            [`getContentWithRevision-${options.name}`]: pcs.getContent.bind(pcs)
        },
        resources: [
            { uri: `/{domain}/sys/key_value/${options.name}` }
        ]
    };
};
