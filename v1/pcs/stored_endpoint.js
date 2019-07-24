'use strict';

const HyperSwitch = require('hyperswitch');
const URI = HyperSwitch.URI;
const mwUtils = require('../../lib/mwUtil');

class PCSEndpoint {
    constructor(options) {
        this._options = options;
    }

    _injectCacheControl(res) {
        res.headers = res.headers || {};
        res.headers['cache-control'] = this._options.response_cache_control;
        return res;
    }

    getContent(hyper, req) {
        if (mwUtils.isNoCacheRequest(req)) {
            return this._fetchFromPCSAndStore(hyper, req)
            .tap(this._injectCacheControl.bind(this));
        }

        const rp = req.params;
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
        .tap(this._injectCacheControl.bind(this));
    }

    _purgeURIs(hyper, req, revision) {
        const rp = req.params;
        return mwUtils.getSiteInfo(hyper, req)
        .then((siteInfo) => {
            const path = `${siteInfo.baseUri}/page/${this._options.name}`.replace(/^https?:/, '');
            const title = encodeURIComponent(rp.title);
            let purgeEvents = [
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
        });
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
