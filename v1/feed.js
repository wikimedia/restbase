'use strict';

const P = require('bluebird');
const HyperSwitch = require('hyperswitch');
const Template = HyperSwitch.Template;
const mwUtil = require('../lib/mwUtil');
const BaseFeed = require('../lib/base_feed');

const PARTS_URIS = {
    tfa: {
        reqTemplate: new Template({
            uri: '{{options.host}}/{{domain}}/v1/page/featured/{{yyyy}}/{{mm}}/{{dd}}',
            query: {
                aggregated: true
            },
            headers: {
                'accept-language': '{{accept-language}}'
            }
        }),
        renewable: true
    },
    mostread: {
        reqTemplate: new Template({
            uri: '{{options.host}}/{{domain}}/v1/page/most-read/{{yyyy}}/{{mm}}/{{dd}}',
            query: {
                aggregated: true
            },
            headers: {
                'accept-language': '{{accept-language}}'
            }
        }),
        renewable: true
    },
    image: {
        reqTemplate: new Template({
            uri: '{{options.host}}/{{domain}}/v1/media/image/featured/{{yyyy}}/{{mm}}/{{dd}}',
            query: {
                aggregated: true
            },
            headers: {
                'accept-language': '{{accept-language}}'
            }
        }),
        renewable: true
    },
    news: {
        reqTemplate: new Template({
            uri: '{{options.host}}/{{domain}}/v1/page/news',
            query: {
                aggregated: true
            },
            headers: {
                'accept-language': '{{accept-language}}'
            }
        }),
        renewable: false
    },
    onthisday: {
        reqTemplate: new Template({
            uri: '{{options.host}}/{{domain}}/v1/feed/onthisday/selected/{{mm}}/{{dd}}',
            headers: {
                'accept-language': '{{accept-language}}'
            }
        }),
        renewable: true
    }
};

class Feed extends BaseFeed {
    _makeFeedRequests(hyper, req, isHistoric) {
        const props = {};
        let parts = Object.keys(PARTS_URIS);
        if (isHistoric) {
            parts = parts.filter((part) => PARTS_URIS[part].renewable);
        }
        parts.forEach((part) => {
            props[part] = hyper.get(PARTS_URIS[part].reqTemplate.expand({
                options: this.options,
                request: req
            }))
            // Don't fail all if one of the parts failed.
            .catchReturn({});
        });
        return P.props(props);
    }

    getDateAndKey(req) {
        mwUtil.verifyDateParams(req);
        const date = mwUtil.getDateSafe(req.params);
        return {
            date,
            key: date.toISOString().split('T').shift()
        };
    }

    constructBody(result) {
        const body = {};
        Object.keys(result).forEach((key) => {
            if (result[key].body && Object.keys(result[key].body).length) {
                if (key === 'onthisday' && result.onthisday.body.selected) {
                    body[key] = result.onthisday.body.selected;
                } else {
                    body[key] = result[key].body;
                }
            }
        });
        return body;
    }
}

const spec = HyperSwitch.utils.loadSpec(`${__dirname}/feed.yaml`);

module.exports = (options) => {
    options.name = 'feed.aggregated';
    // TODO: need a way to dynamically derive this
    options.content_type = 'application/json; charset=utf-8; ' +
        'profile="https://www.mediawiki.org/wiki/Specs/aggregated-feed/0.5.0"';
    options.spec = spec;

    return new Feed(options).getModuleDeclaration();
};
