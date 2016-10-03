'use strict';


const P = require('bluebird');
const HyperSwitch = require('hyperswitch');
const uuid = require('cassandra-uuid').TimeUuid;

const URI = HyperSwitch.URI;
const HTTPError = HyperSwitch.HTTPError;

const spec = HyperSwitch.utils.loadSpec(`${__dirname}/feed.yaml`);


const DEFAULT_TTL = 3600;

const FEED_URIS = {
    tfa: { uri: ['v1', 'page', 'featured'], date: true },
    mostread: { uri: ['v1', 'page', 'most-read'], date: true },
    random: { uri: ['v1', 'page', 'random', 'title'], date: false },
    image: { uri: ['v1', 'media', 'image', 'featured'], date: true },
    news: { uri: ['v1', 'page', 'news'], date: false }
};


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

    aggregated(hyper, req) {
        const rp = req.params;
        let date;
        let dateArr;

        // key the records on the date in the format YYYY-MM-DD
        try {
            date = new Date(Date.UTC(rp.yyyy, rp.mm - 1, rp.dd));
            date = date.toISOString().split('T').shift();
            dateArr = date.split('-');
        } catch (err) {
            throw new HTTPError({
                status: 400,
                body: {
                    type: 'bad_request',
                    description: 'wrong date format specified'
                }
            });
        }

        // check if we have a record in Cassandra already
        return hyper.get({
            uri: new URI([rp.domain, 'sys', 'key_value', 'feed.aggregated', date])
        }).then((res) => {
            // we've got a cache hit, so we just need to request
            // the random component and return the bundle
            if (!res.body) {
                throw new HTTPError({
                    status: 500,
                    body: {
                        type: '#internal_error',
                        detail: `No data received for aggregated feed date ${date}`,
                        feed_date: date
                    }
                });
            }
            return this._makeFeedRequests(['random'], hyper, rp).then((rndRes) => {
                res.body.random = rndRes.random.body;
                // make a new ETag since we are changing a part of the body
                res.headers.etag = `${dateArr.join('')}/${uuid.now().toString()}`;
                return res;
            }).catch(() => res); // something went wrong while retrieving the random part of
            // the response from MCS, so just return the stored content
            // as there is no need to error out for this edge case
        }).catch({ status: 404 }, () => // it's a cache miss, so we need to request all
            // of the components and store them
            this._makeFeedRequests(Object.keys(FEED_URIS), hyper, rp, dateArr)
            .then((result) => {
                // assemble the final response to be returned
                const finalResult = {
                    status: 200,
                    headers: {
                        'cache-control': this.options.feed_cache_control,
                        // mimic MCS' ETag value
                        etag: `${dateArr.join('')}/${uuid.now().toString()}`,
                        // TODO: need a way to dynamically derive this
                        'content-type': 'application/json; charset=utf-8; ' +
                        'profile="https://www.mediawiki.org/wiki/Specs/aggregated-feed/0.5.0"'
                    },
                    body: {}
                };
                // populate its body
                Object.keys(result).forEach((key) => {
                    if (result[key].body && Object.keys(result[key].body).length) {
                        finalResult.body[key] = result[key].body;
                    }
                });
                // store it
                return hyper.put({
                    uri: new URI([rp.domain, 'sys', 'key_value', 'feed.aggregated', date]),
                    headers: finalResult.headers,
                    body: finalResult.body
                }).then(() => finalResult);
            }))
        .then((res) => {
            // We've got the titles, populate them with summaries
            const feed = res.body;
            const summaries = {};
            const requestTitle = (title) => {
                if (title && !summaries[title]) {
                    summaries[title] = hyper.get({
                        uri: new URI([rp.domain, 'v1', 'page', 'summary', title])
                    })
                    .get('body')
                    // Swallow the error, no need to fail the whole feed
                    // request because of one failed summary fetch
                    .catchReturn(undefined);
                }
            };

            if (feed.tfa) {
                requestTitle(feed.tfa.title);
            }
            if (feed.mostread && feed.mostread.articles) {
                feed.mostread.articles.forEach((article) => { requestTitle(article.title); });
            }
            if (feed.random && feed.random.items) {
                feed.random.items.forEach((article) => { requestTitle(article.title); });
            }
            if (feed.news) {
                feed.news.forEach((newsItem) => {
                    if (newsItem.links) {
                        newsItem.links.forEach((article) => {
                            requestTitle(article.title);
                        });
                    }
                });
            }

            return P.props(summaries)
            .then((summaries) => {
                const assignSummary = (article) => {
                    if (!summaries[article.title]) {
                        return;
                    }
                    // MCS expects the title to be a DB Key
                    delete summaries[article.title].title;
                    const result = Object.assign(article, summaries[article.title]);
                    if (!result.normalizedtitle) {
                        result.normalizedtitle = result.title.replace(/_/g, ' ');
                    }
                    return result;
                };

                const assignAllSummaries = (articles) => {
                    if (!articles) {
                        return;
                    }
                    return articles.map(assignSummary).filter((article) => !!article);
                };

                feed.tfa = feed.tfa && assignSummary(feed.tfa);
                if (feed.mostread) {
                    feed.mostread.articles = assignAllSummaries(feed.mostread.articles);
                }

                if (feed.random) {
                    feed.random.items = assignAllSummaries(feed.random.items);
                }

                if (feed.news) {
                    feed.news.forEach((newsItem) => {
                        newsItem.links = assignAllSummaries(newsItem.links);
                    });
                }
                return res;
            });
        });
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
        resources: [{
            uri: '/{domain}/sys/key_value/feed.aggregated',
            body: {
                valueType: 'json',
                retention_policy: {
                    type: 'ttl',
                    ttl: options.ttl
                }
            }
        }]
    };
};
