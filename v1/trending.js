'use strict';


const HyperSwitch = require('hyperswitch');
const mwUtil = require('../lib/mwUtil');
const URI = HyperSwitch.URI;

const spec = HyperSwitch.utils.loadSpec(`${__dirname}/trending.yaml`);

class TrendingEdits {
    constructor(options) {
        this.options = options;
    }

    getTrending(hyper, req) {
        mwUtil.verifyDateParams(req);
        const rp = req.params;
        const date = mwUtil.getDateSafe(rp);
        const dateKey = mwUtil.dateToKey(date);
        const populateSummaries = (res) => {
            function fetchSummary(uri) {
                return hyper.get({ uri })
                .then((res) => {
                    res.body.normalizedtitle = res.body.title;
                    res.body.title = res.body.title.replace(/ /g, '_');
                    return res.body;
                })
                // Swallow the error, no need to fail the whole feed
                // request because of one failed summary fetch
                .catchReturn(undefined);
            }
            return mwUtil.hydrateResponse(res, fetchSummary);
        };
        const getContent = (bucket, forwardCacheControl) => {
            const request = {
                uri: new URI([rp.domain, 'sys', 'key_value', bucket, dateKey])
            };
            if (forwardCacheControl && req.headers && req.headers['cache-control']) {
                request.headers = {
                    'cache-control': req.headers['cache-control']
                };
            }
            return hyper.get(request);
        };
        const storeContent = (res, bucket) => {
            return hyper.put({
                uri: new URI([rp.domain, 'sys', 'key_value', bucket, dateKey]),
                headers: res.headers,
                body: res.body
            });
        };
        const getCurrentContent = () => {
            return hyper.get({
                uri: `${this.options.host}/${rp.domain}/v1/feed/trending-edits`
            })
            .tap((res) => {
                storeContent(res, 'feed.trending.historic');
            });
        };
        if (mwUtil.isHistoric(date)) {
            return getContent('feed.trending.historic').then(populateSummaries);
        }
        return getCurrentContent().then(populateSummaries);
    }
}

module.exports = (options) => {
    if (!options.host) {
        throw new Error('trending-edits module: host option missing');
    }

    const feed = new TrendingEdits(options);

    return {
        spec,
        operations: {
            trendingEdits: feed.getTrending.bind(feed)
        },
        resources: [
            {
                uri: '/{domain}/sys/key_value/feed.trending.historic',
                body: {
                    version: 1,
                    valueType: 'json'
                }
            }
        ]
    };
};
