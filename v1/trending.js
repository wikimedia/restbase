'use strict';


const HyperSwitch = require('hyperswitch');
const mwUtil = require('../lib/mwUtil');
const uuid = require('cassandra-uuid').TimeUuid;

const spec = HyperSwitch.utils.loadSpec(`${__dirname}/trending.yaml`);

const CONTENT_TYPE = 'application/json; charset=utf-8; ' +
    'profile="https://www.mediawiki.org/wiki/Specs/trending-feed/0.5.0"';

class TrendingEdits {
    constructor(options) {
        this.options = options;
    }

    _assembleResult(result) {
        // assemble the final response to be returned
        return {
            status: 200,
            headers: {
                'cache-control': this.options.cache_control,
                // mimic ETag value
                etag: `${uuid.now().toString()}`,
                'content-type': CONTENT_TYPE
            },
            body: result.body
        };
    }

    getTrending(hyper, req) {
        const rp = req.params;
        return hyper.get({
            uri: `${this.options.host}/${rp.domain}/v1/feed/trending-edits/${rp.period || ''}`
        })
        .then(res => this._assembleResult(res))
        .then(res => mwUtil.hydrateResponse(res, uri =>
            mwUtil.fetchSummary(hyper, uri)));
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
        }
    };
};
