'use strict';


const P = require('bluebird');
const HyperSwitch = require('hyperswitch');
const uuid = require('cassandra-uuid').TimeUuid;
const mwUtil = require('./mwUtil');
const URI = HyperSwitch.URI;

const DEFAULT_TTL = 3600;
const DEFAULT_CACHE_CONTROL = 's-maxage=30, max-age=15';

class BaseFeed {
    constructor(options) {
        options.ttl = options.ttl || DEFAULT_TTL;
        options.feed_cache_control = options.feed_cache_control || DEFAULT_CACHE_CONTROL;
        if (!options.host) {
            throw new Error('feed module: host option missing');
        }

        this.options = options;
    }

    _assembleResult(result, dateKey) {
        // assemble the final response to be returned
        return {
            status: 200,
            headers: {
                'cache-control': this.options.feed_cache_control,
                // mimic MCS' ETag value
                etag: `${dateKey}/${uuid.now().toString()}`,
                'content-type': this.options.content_type
            },
            body: this.constructBody(result)
        };
    }

    _hydrateResponse(hyper, req, res) {
        return mwUtil.hydrateResponse(res, (uri) => mwUtil.fetchSummary(hyper, uri));
    }

    getDateAndKey(req) {
        throw new Error('Abstract. Must be overwritten');
    }

    constructBody(result) {
        throw new Error('Abstract. Must be overwritten');
    }

    aggregated(hyper, req) {
        const rp = req.params;
        const dateAndKey = this.getDateAndKey(req);
        const date = dateAndKey.date;
        const dateKey = dateAndKey.key;
        const populateSummaries = (res) => this._hydrateResponse(hyper, req, res);
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
            return getContent(this._getCurrentBucketName(), true)
            .catch({ status: 404 }, () =>
                // it's a cache miss, so we need to request all
                // of the components and store them
                this._makeFeedRequests(hyper, req, false)
                .then((result) => this._assembleResult(result, dateKey))
                .tap((res) => {
                    const storeReqs = [ storeContent(res, this._getCurrentBucketName()) ];
                    if (this.options.storeHistory) {
                        storeReqs.push(storeContent(res, this._getHistoricBucketName()));
                    }
                    // Store async
                    P.all(storeReqs);
                }));
        };
        const requestHistoricContentFromMCS = () => {
            return this._makeFeedRequests(hyper, req, true)
            .then((result) => this._assembleResult(result, dateKey));
        };
        const getHistoricContent = () => {
            if (mwUtil.isNoCacheRequest(req)) {
                // Need to update only the parts of content
                // we're able to regenerate and reuse others
                return P.join(
                    getContent(this._getHistoricBucketName())
                    .catchReturn({ status: 404 }, {
                        status: 404,
                        headers: {},
                        body: {}
                    }),
                    requestHistoricContentFromMCS()
                )
                .then((results) => {
                    results[0].status = 200;
                    Object.assign(results[0].body, results[1].body);
                    Object.assign(results[0].headers, results[1].headers);
                    // Store async
                    storeContent(results[0], this._getHistoricBucketName());
                    return results[0];
                });
            } else {
                return getContent(this._getHistoricBucketName())
                .catch({ status: 404 }, () =>
                    // it's a cache miss, so we need to request all
                    // of the components and store them (but don't request news)
                    requestHistoricContentFromMCS()
                    .tap((res) => {
                        // Store async
                        storeContent(res, this._getHistoricBucketName());
                    })
                );
            }
        };

        if (this.options.storeHistory && mwUtil.isHistoric(date)) {
            return getHistoricContent().then(populateSummaries);
        } else {
            return getCurrentContent().then(populateSummaries);
        }
    }

    _getCurrentBucketName() {
        return this.options.name;
    }

    _getHistoricBucketName() {
        return `${this.options.name}.historic`;
    }

    getModuleDeclaration() {
        const resources = [
            {
                uri: `/{domain}/sys/key_value/${this._getCurrentBucketName()}`,
                body: {
                    version: 2,
                    valueType: 'json',
                    retention_policy: {
                        type: 'ttl',
                        ttl: this.options.ttl
                    }
                }
            }
        ];
        if (this.options.storeHistory) {
            resources.push({
                uri: `/{domain}/sys/key_value/${this._getHistoricBucketName()}`,
                body: {
                    version: 1,
                    valueType: 'json'
                }
            });
        }

        return {
            spec: this.options.spec,
            operations: {
                aggregatedFeed: this.aggregated.bind(this)
            },
            resources
        };
    }
}

module.exports = BaseFeed;
