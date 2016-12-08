'use strict';


const HyperSwitch = require('hyperswitch');
const mwUtil = require('../lib/mwUtil');
const URI = HyperSwitch.URI;

const spec = HyperSwitch.utils.loadSpec(`${__dirname}/trending.yaml`);

class TrendingEdits {
    constructor(options) {
        this.options = options;
    }

    _assembleResult(result, dateArr) {
        // assemble the final response to be returned
        return {
            status: 200,
            headers: {
                'cache-control': this.options.feed_cache_control,
                // mimic MCS' ETag value
                etag: `${dateArr.join('')}/${uuid.now().toString()}`,
                'content-type': CONTENT_TYPE
            },
            body: constructBody(result)
        };
    }

    getTrending(hyper, req) {
        mwUtil.verifyDateParams(req);
        const rp = req.params;
        const date = mwUtil.getDateSafe(rp);
        const dateKey = mwUtil.dateToKey(date);
        const dateArr = dateKey.split('-');
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
        const getContent = (bucket) => {
            return hyper.get({
                uri: new URI([rp.domain, 'sys', 'key_value', bucket, dateKey])
            })
            .then((res) => this._assembleResult(res, dateArr));
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
            })
            .then((res) => this._assembleResult(res, dateArr));
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
