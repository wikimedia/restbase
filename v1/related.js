'use strict';

const mwUtil = require('../lib/mwUtil');
const HyperSwitch = require('hyperswitch');
const URI = HyperSwitch.URI;

const spec = HyperSwitch.utils.loadSpec(`${__dirname}/related.yaml`);

class Related {
    constructor(options) {
        this._options = options;
    }

    _relatedPageRedirect(hyper, domain, title) {
        const apiURI = new URI([domain, 'sys', 'action', 'rawquery']);

        return hyper.get({
            uri: apiURI,
            headers: {
                'content-type': 'application/json'
            },
            body: {
                action: 'query',
                format: 'json',
                titles: title,
                redirects: 1,
                converttitles: 1
            }
        }).then((res) => {
            return res.body;
        }).catch((e) => {
            hyper.logger.log('error/related', {
                message: 'Failed to fetch related pages',
                error: e
            });
            throw e;
        });
    }

    getPages(hyper, req) {
        const rp = req.params;

        return this._relatedPageRedirect(hyper, rp.domain, rp.title).then((res) => {

            // Return the right title to redirect if it has another language option
            if (res && res.query) {
                if (res.query.converted) {
                    rp.title = res.query.converted[0].to;
                } else if (res.query.redirects) {
                    rp.title = res.query.redirects[0].to;
                }
            }

            const rh = Object.assign({}, req.headers);
            // we don't store /page/related no need for cache-control
            if (rh['cache-control']) {
                delete rh['cache-control'];
            }

            return hyper.post({
                uri: new URI([rp.domain, 'sys', 'action', 'query']),
                body: {
                    format: 'json',
                    generator: 'search',
                    gsrsearch: `morelike:${rp.title}`,
                    gsrnamespace: 0,
                    gsrwhat: 'text',
                    gsrinfo: '',
                    gsrprop: 'redirecttitle',
                    gsrlimit: 20
                }
            })
            .then((res) => {
                delete res.body.next;

                // Step 1: Normalize and convert titles to use $merge
                res.body.items.forEach((item) => {
                    // We can avoid using the full-blown title normalisation here because
                    // the titles come from MW API and they're already normalised except
                    // they use spaces instead of underscores.
                    item.$merge = [ new URI([rp.domain, 'v1', 'page',
                        'summary', item.title.replace(/ /g, '_')]) ];
                    delete item.title;
                });

                // Rename `items` to `pages`
                res.body.pages = res.body.items;
                delete res.body.items;

                // Step 2: Hydrate response as always.
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
            });
        });
    }
}

module.exports = (options) => {
    const relatedModule = new Related(options);

    return {
        spec,
        operations: {
            getRelatedPages: relatedModule.getPages.bind(relatedModule)
        }
    };
};
