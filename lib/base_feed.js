'use strict';

const P = require('bluebird');
const HyperSwitch = require('hyperswitch');
const uuidv1 = require('uuid').v1;
const mwUtil = require('./mwUtil');
const URI = HyperSwitch.URI;

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

    _hydrateResponse(hyper, req, res) {
        const rh = Object.assign({}, req.headers);
        // we don't store /feed/featured no need for cache-control (?)
        if (rh.host) {
            /*
                Keeping the host header makes the fetchSumary fail with HTTPError 504
                'Hostname/IP does not match certificate\'s altnames: Host: localhost.
                is not in the cert's altnames. Maybe this will happen only locally?
                Should we delete the header? Is there a filter that already do that?
            */
            delete rh.host;
        }

        return mwUtil.hydrateResponse(res, (uri) => {
            return mwUtil.fetchSummary(hyper, uri, rh).then((result) => {
                if (!result) {
                    return result;
                }

                // Assign content-language and vary header to parent response
                // based on one of summary responses
                if (res && res.headers && !res.headers['content-language'] &&
                result['content-language']) {
                    res.headers['content-language'] = result['content-language'];
                    mwUtil.addVaryHeader(res, 'accept-language');
                }
                return result.summary;
            });
        });
    }

    getDateAndKey(req) {
        throw new Error('Abstract. Must be overwritten');
    }

    constructBody(result, req) {
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
        const requestCurrentContentFromMCS = () => this._makeFeedRequests(hyper, req, false)
        .then((result) => this._assembleResult(result, dateKey, req))
        .tap((res) => {
            if (this.options.storeHistory) {
                // Store async
                storeContent(res, this._getHistoricBucketName());
            }
        });

        const requestHistoricContentFromMCS = () => this._makeFeedRequests(hyper, req, true)
        .then((result) => this._assembleResult(result, dateKey, req));

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
        } else if (mwUtil.isHistoric(date)) {
            return requestHistoricContentFromMCS().then(populateSummaries);
        } else {
            return requestCurrentContentFromMCS().then(populateSummaries);
        }
    }

    _getHistoricBucketName() {
        return this.options.name;
    }

    getModuleDeclaration() {
        const resources = [];
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
                aggregatedFeed: this.aggregated.bind(this),
                onThisDay: this.aggregated.bind(this)
            },
            resources
        };
    }
}

module.exports = BaseFeed;
