'use strict';


const P = require('bluebird');
const HyperSwitch = require('hyperswitch');
const uuid = require('cassandra-uuid').TimeUuid;
const mwUtil = require('../lib/mwUtil');
const URI = HyperSwitch.URI;
const HTTPError = HyperSwitch.HTTPError;

const spec = HyperSwitch.utils.loadSpec(`${__dirname}/feed.yaml`);

const DEFAULT_TTL = 3600;

const FEED_URIS = {
    tfa: { uri: ['v1', 'page', 'featured'], date: true },
    mostread: { uri: ['v1', 'page', 'most-read'], date: true },
    image: { uri: ['v1', 'media', 'image', 'featured'], date: true },
    news: { uri: ['v1', 'page', 'news'], date: false }
};

// TODO: need a way to dynamically derive this
const CONTENT_TYPE = 'application/json; charset=utf-8; ' +
    'profile="https://www.mediawiki.org/wiki/Specs/aggregated-feed/0.5.0"';

/**
 * Checks whether the date is today or in the past in UTC-0 timezone
 *
 * @param {Date} date a date to check
 * @return {boolean} true if the date is in the past
 */
function isHistoric(date) {
    const now = new Date();
    const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    return date < today;
}

/**
 * Safely builds the Date from request parameters
 *
 * @param {Object} rp request parameters object
 * @return {Date} the requested date.
 */
function getDateSafe(rp) {
    try {
        return new Date(Date.UTC(rp.yyyy, rp.mm - 1, rp.dd));
    } catch (err) {
        throw new HTTPError({
            status: 400,
            body: {
                type: 'bad_request',
                description: 'wrong date format specified'
            }
        });
    }
}

/**
 * Converts the date to the bucket key, key the records in the format YYYY-MM-DD
 *
 * @param {Date} date the date to convert
 * @return {string}
 */
function toKey(date) {
    return date.toISOString().split('T').shift();
}


class Feed {
    constructor(options) {
        this.options = options;
    }

    _makeFeedRequests(parts, hyper, rp, dateArr) {
        const props = {};
        parts.forEach((part) => {
            const def = FEED_URIS[part];
            const uriArray = [this.options.host, rp.domain].concat(def.uri);
            if (def.date) {
                Array.prototype.push.apply(uriArray, dateArr);
            }
            props[part] = hyper.get({
                uri: uriArray.join('/'),
                query: { aggregated: true }
            });
        });
        return P.props(props);
    }

    _assembleResult(result, dateArr) {
        // assemble the final response to be returned
        const finalResult = {
            status: 200,
            headers: {
                'cache-control': this.options.feed_cache_control,
                // mimic MCS' ETag value
                etag: `${dateArr.join('')}/${uuid.now().toString()}`,
                'content-type': CONTENT_TYPE
            },
            body: {}
        };
        // hydrateResponse its body
        Object.keys(result).forEach((key) => {
            if (result[key].body && Object.keys(result[key].body).length) {
                finalResult.body[key] = result[key].body;
            }
        });
        return finalResult;
    }

    aggregated(hyper, req) {
        const rp = req.params;
        const date = getDateSafe(rp);
        const dateKey = toKey(date);
        const dateArr = dateKey.split('-');
        const populateSummaries = (res) => {
            function fetchSummary(uri) {
                return hyper.get({ uri })
                .then((res) => {
                    res.body.normalizedtitle = res.body.title.replace(/_/g, ' ');
                    delete res.body.title; // MSC expects title to be the db-key
                    return res.body;
                })
                // Swallow the error, no need to fail the whole feed
                // request because of one failed summary fetch
                .catchReturn(undefined);
            }
            return mwUtil.hydrateResponse(res, fetchSummary, '$merge');
        };
        // TODO: TEMP CODE: add '$merge' key until the MCS implements it
        const replaceTitleWith$merge = (response) => {
            function _traverse(node) {
                if (Array.isArray(node)) {
                    for (let i = 0; i < node.length; i++) {
                        _traverse(node[i]);
                    }
                } else if (typeof node === 'object') {
                    if (node.title) {
                        node.$merge = [
                            `https://${rp.domain}/api/rest_v1/page/summary/`
                                + `${encodeURIComponent(node.title)}`
                        ];
                    } else {
                        Object.keys(node).forEach((key) => _traverse(node[key]));
                    }
                }
            }
            _traverse(response);
            return response;
        };
        const getContent = (bucket) => hyper.get({
            uri: new URI([rp.domain, 'sys', 'key_value', 'feed.aggregated', dateKey])
        });
        const storeContent = (res, bucket) => {
            return hyper.put({
                uri: new URI([rp.domain, 'sys', 'key_value', bucket, date]),
                headers: res.headers,
                body: res.body
            });
        };
        const getCurrentContent = () => {
            return getContent('feed.aggregated')
            .catch({ status: 404 }, () =>
                // it's a cache miss, so we need to request all
                // of the components and store them
                this._makeFeedRequests(Object.keys(FEED_URIS), hyper, rp, dateArr)
                .then((result) => this._assembleResult(result, dateArr))
                .then(replaceTitleWith$merge)
                .tap((res) => {
                    // Store async
                    P.join(
                        storeContent(res, 'feed.aggregated'),
                        storeContent(res, 'feed.aggregated.historic')
                    );
                }));
        };
        const getHistoricContent = () => {
            return getContent('feed.aggregated.historic')
            .catch({ status: 404 }, () =>
                // it's a cache miss, so we need to request all
                // of the components and store them (but don't request news)
                this._makeFeedRequests([ 'tfa', 'mostread', 'image' ], hyper, rp, dateArr)
                .then((result) => this._assembleResult(result, dateArr))
                .then(replaceTitleWith$merge)
                .tap((res) => {
                    // Store async
                    storeContent(res, 'feed.aggregated.historic');
                })
            );
        };


        const contentRequest = isHistoric(date) ? getHistoricContent() : getCurrentContent();
        return contentRequest.then(populateSummaries);
    }
}


module.exports = (options) => {
    options.ttl = options.ttl || DEFAULT_TTL;
    options.feed_cache_control = options.feed_cache_control || 's-maxage=30, max-age=15';
    if (!options.host) {
        throw new Error('feed module: host option missing');
    }

    const feed = new Feed(options);

    return {
        spec,
        operations: {
            aggregatedFeed: feed.aggregated.bind(feed)
        },
        resources: [
            {
                uri: '/{domain}/sys/key_value/feed.aggregated',
                body: {
                    version: 2,
                    valueType: 'json',
                    retention_policy: {
                        type: 'ttl',
                        ttl: options.ttl
                    }
                }
            },
            {
                uri: '/{domain}/sys/key_value/feed.aggregated.historic',
                body: {
                    version: 1,
                    valueType: 'json'
                }
            }
        ]
    };
};
