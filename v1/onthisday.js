'use strict';

const P = require('bluebird');
const HyperSwitch = require('hyperswitch');
const Template = HyperSwitch.Template;
const BaseFeed = require('../lib/base_feed');
const mwUtil = require('../lib/mwUtil');

const POSSIBLE_PARTS = [
    'selected',
    'births',
    'deaths',
    'events',
    'holidays'
];

const REQUEST_TEMPLATE = new Template({
    uri: '{{options.host}}/{{domain}}/v1/feed/onthisday/{{type}}/{{mm}}/{{dd}}'
});

class Feed extends BaseFeed {
    getDateAndKey(req) {
        return {
            date: undefined, // Never actually used
            key: `${req.params.mm}${req.params.dd}`
        };
    }

    constructBody(result, req) {
        if (req.params.type === 'all') {
            const body = {};
            Object.keys(result).forEach((key) => Object.assign(body, result[key].body));
            return body;
        }
        return result.body;
    }

    _hydrateResponse(hyper, req, res) {
        return super._hydrateResponse(hyper, req, res)
        .then((response) => {
            Object.keys(response.body).forEach((key) => {
                if (!Array.isArray(response.body[key])) {
                    return;
                }
                response.body[key].forEach((elem) => {
                    if (!elem || !Array.isArray(elem.pages)) {
                        return;
                    }
                    elem.pages = mwUtil.removeDuplicateTitles(elem.pages);
                });
            });
            return response;
        });
    }

    _makeFeedRequests(hyper, req) {
        if (req.params.type === 'all') {
            const requests = {};
            const reqCopy = Object.assign({}, req);
            POSSIBLE_PARTS.forEach((type) => {
                reqCopy.params = Object.assign({}, req.params, { type });
                requests[type] = hyper.get(REQUEST_TEMPLATE.expand({
                    options: this.options,
                    request: reqCopy
                }))
                .catch((e) => {
                    hyper.logger.log('error/onthisday', {
                        msg: `Error fetching ${type}`,
                        error: e
                    });
                    // Just ignore individual portions errors
                    return undefined;
                });
            });
            return P.props(requests);
        } else {
            return hyper.get(REQUEST_TEMPLATE.expand({
                options: this.options,
                request: req
            }));
        }
    }
}

const spec = HyperSwitch.utils.loadSpec(`${__dirname}/onthisday.yaml`);

module.exports = (options) => {
    options.name = 'feed.onthisday';
    // TODO: need a way to dynamically derive this
    options.content_type = 'application/json; charset=utf-8; ' +
        'profile="https://www.mediawiki.org/wiki/Specs/onthisday-feed/0.5.0"';
    options.spec = spec;
    options.storeHistory = false;

    return new Feed(options).getModuleDeclaration();
};
