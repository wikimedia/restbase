'use strict';

const uuidv1 = require('uuid').v1;
const mwUtil = require('./mwUtil');

const DEFAULT_CACHE_CONTROL = 's-maxage=30, max-age=15';

class BaseFeed {
    constructor(options) {
        options.feed_cache_control = options.feed_cache_control || DEFAULT_CACHE_CONTROL;
        if (!options.host) {
            throw new Error('feed module: host option missing');
        }

        this.options = options;
    }

    _assembleResult(result, dateKey, req) {
        // assemble the final response to be returned
        return {
            status: 200,
            headers: {
                'cache-control': this.options.feed_cache_control,
                // mimic MCS' ETag value
                etag: `${dateKey}/${uuidv1()}`,
                'content-type': this.options.content_type
            },
            body: this.constructBody(result, req)
        };
    }

    getDateAndKey(req) {
        throw new Error('Abstract. Must be overwritten');
    }

    constructBody(result, req) {
        throw new Error('Abstract. Must be overwritten');
    }

    aggregated(hyper, req) {
        const dateAndKey = this.getDateAndKey(req);
        const date = dateAndKey.date;
        const dateKey = dateAndKey.key;

        const requestCurrentContentFromMCS = () => this._makeFeedRequests(hyper, req, false)
        .then((result) => this._assembleResult(result, dateKey, req));

        const requestHistoricContentFromMCS = () => this._makeFeedRequests(hyper, req, true)
        .then((result) => this._assembleResult(result, dateKey, req));

        if (mwUtil.isHistoric(date)) {
            return requestHistoricContentFromMCS();
        } else {
            return requestCurrentContentFromMCS();
        }
    }

    getModuleDeclaration() {
        return {
            spec: this.options.spec,
            operations: {
                aggregatedFeed: this.aggregated.bind(this),
                onThisDay: this.aggregated.bind(this)
            }
        };
    }
}

module.exports = BaseFeed;
