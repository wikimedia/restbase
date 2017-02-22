'use strict';


const P = require('bluebird');
const HyperSwitch = require('hyperswitch');
const URI = HyperSwitch.URI;
const Template = HyperSwitch.Template;
const mwUtil = require('../lib/mwUtil');
const BaseFeed = require('../lib/base_feed');

const PARTS_URIS = {
    tfa: {
        reqTemplate: new Template({
            uri: '{{options.host}}/{{domain}}/v1/page/featured/{{yyyy}}/{{mm}}/{{dd}}',
            query: {
                aggregated: true
            }
        }),
        renewable: true
    },
    mostread: {
        reqTemplate: new Template({
            uri: '{{options.host}}/{{domain}}/v1/page/most-read/{{yyyy}}/{{mm}}/{{dd}}',
            query: {
                aggregated: true
            }
        }),
        renewable: true
    },
    image: {
        reqTemplate: new Template({
            uri: '{{options.host}}/{{domain}}/v1/media/image/featured/{{yyyy}}/{{mm}}/{{dd}}',
            query: {
                aggregated: true
            }
        }),
        renewable: true
    },
    news: {
        reqTemplate: new Template({
            uri: '{{options.host}}/{{domain}}/v1/page/news',
            query: {
                aggregated: true
            }
        }),
        renewable: false
    },
    onthisday: {
        reqTemplate: new Template({
            uri: '{{options.host}}/{{domain}}/v1/onthisday/selected/{{mm}}/{{dd}}'
        }),
        renewable: true
    }
};

class Feed extends BaseFeed {
    // TODO: this is temporary code to increase the size of the TFA thumbnail
    _hydrateResponse(hyper, req, res) {
        const rp = req.params;
        const fetchSummary = (uri) => mwUtil.fetchSummary(hyper, uri);
        if (res.body.tfa && res.body.tfa.$merge && res.body.tfa.$merge.length) {
            const summaryURI = res.body.tfa.$merge[0];
            const title = decodeURIComponent(
                summaryURI.substr(summaryURI.lastIndexOf('/') + 1));
            const highQualityThumbRequest = hyper.get({
                method: 'post',
                uri: new URI([rp.domain, 'sys', 'action', 'query']),
                body: {
                    prop: 'pageimages',
                    piprop: 'thumbnail|original',
                    pithumbsize: 640,
                    pilicense: 'any',
                    titles: title
                }
            });
            return P.join(
                mwUtil.hydrateResponse(res, fetchSummary),
                highQualityThumbRequest
            ).then((result) => {
                const thumbRes = result[1].body;
                if (thumbRes.items && thumbRes.items.length && thumbRes.items[0].thumbnail) {
                    const newThumb = thumbRes.items[0].thumbnail;
                    newThumb.source = newThumb.source.replace(/^http:/, 'https:');
                    result[0].body.tfa.thumbnail = newThumb;
                    if (thumbRes.items[0].original) {
                        const newOriginal = thumbRes.items[0].original;
                        newOriginal.source = newOriginal.source.replace(/^http:/, 'https:');
                        result[0].body.tfa.originalimage = newOriginal;
                    }
                }
                return result[0];
            });
        } else {
            return mwUtil.hydrateResponse(res, fetchSummary);
        }
    }

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
                // TODO: temp code to support transition to new MCS response format
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
    options.storeHistory = true;

    return new Feed(options).getModuleDeclaration();
};
