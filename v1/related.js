'use strict';

const mwUtil = require('../lib/mwUtil');
const HyperSwitch = require('hyperswitch');
const URI = HyperSwitch.URI;

const spec = HyperSwitch.utils.loadSpec(`${__dirname}/related.yaml`);

class Related {
    constructor(options) {
        this._options = options;
    }

    getPages(hyper, req) {
        const rp = req.params;
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
            return mwUtil.hydrateResponse(res, (uri) => mwUtil.fetchSummary(hyper, uri, rh, res));
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
