'use strict';


const P = require('bluebird');
const HyperSwitch = require('hyperswitch');
const uuid = require('cassandra-uuid').TimeUuid;
const mwUtil = require('./mwUtil');
const URI = HyperSwitch.URI;

const DEFAULT_TTL = 3600;
const DEFAULT_CACHE_CONTROL = 's-maxage=30, max-age=15';

function constructBody(result) {
    const body = {};
    Object.keys(result).forEach((key) => {
        if (result[key].body && Object.keys(result[key].body).length) {
            body[key] = result[key].body;
        }
    });
    return body;
}

class BaseFeed {
    constructor(options) {
        options.ttl = options.ttl || DEFAULT_TTL;
        options.feed_cache_control = options.feed_cache_control || DEFAULT_CACHE_CONTROL;
        if (!options.host) {
            throw new Error('feed module: host option missing');
        }

        this.options = options;
    }

    _makeFeedRequests(parts, hyper, rp, dateArr) {
        const props = {};
        parts.forEach((part) => {
            const def = this.options.part_uris[part];
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
        return {
            status: 200,
            headers: {
                'cache-control': this.options.feed_cache_control,
                // mimic MCS' ETag value
                etag: `${dateArr.join('')}/${uuid.now().toString()}`,
                'content-type': this.options.content_type
            },
            body: constructBody(result)
        };
    }

    _hydrateResponse(hyper, req, res) {
        return mwUtil.hydrateResponse(res, (uri) => mwUtil.fetchSummary(hyper, uri));
    }

    aggregated(hyper, req) {
        mwUtil.verifyDateParams(req);
        const rp = req.params;
        const date = mwUtil.getDateSafe(rp);
        const dateKey = mwUtil.dateToKey(date);
        const dateArr = dateKey.split('-');
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
                this._makeFeedRequests(Object.keys(this.options.part_uris),
                    hyper, rp, dateArr)
                .then((result) => this._assembleResult(result, dateArr))
                .tap((res) => {
                    // Store async
                    P.join(
                        storeContent(res, this._getCurrentBucketName()),
                        storeContent(res, this._getHistoricBucketName())
                    );
                }));
        };
        const requestHistoricContentFromMCS = () => {
            return this._makeFeedRequests(this._getRenewableParts(), hyper, rp, dateArr)
            .then((result) => this._assembleResult(result, dateArr));
        };
        const getHistoricContent = () => {
            if (mwUtil.isNoCacheRequest(req)) {
                // Need to update only the parts of content
                // we're able to regenerate and reuse others
                return P.join(
                    getContent(this._getHistoricBucketName())
                    .catch({ status: 404 }, () => ({
                        headers: {},
                        body: {}
                    })),
                    requestHistoricContentFromMCS()
                )
                .then((results) => {
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
        const contentRequest = mwUtil.isHistoric(date) ? getHistoricContent() : getCurrentContent();
        return contentRequest.then(populateSummaries);
    }

    _getRenewableParts() {
        return Object.keys(this.options.part_uris)
        .filter((partName) => this.options.part_uris[partName].renewable);
    }

    _getCurrentBucketName() {
        return this.options.name;
    }

    _getHistoricBucketName() {
        return `${this.options.name}.historic`;
    }

    getModuleDeclaration() {
        return {
            spec: this.options.spec,
            operations: {
                aggregatedFeed: this.aggregated.bind(this)
            },
            resources: [
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
                },
                {
                    uri: `/{domain}/sys/key_value/${this._getHistoricBucketName()}`,
                    body: {
                        version: 1,
                        valueType: 'json'
                    }
                }
            ]
        };
    }
}

module.exports = BaseFeed;
