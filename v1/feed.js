'use strict';


const P = require('bluebird');
const HyperSwitch = require('hyperswitch');
const URI = HyperSwitch.URI;
const mwUtil = require('../lib/mwUtil');
const BaseFeed = require('../lib/base_feed');

const PARTS_URIS = {
    tfa: {
        uri: ['v1', 'page', 'featured'],
        date: true,
        renewable: true
    },
    mostread: {
        uri: ['v1', 'page', 'most-read'],
        date: true,
        renewable: true
    },
    image: {
        uri: ['v1', 'media', 'image', 'featured'],
        date: true,
        renewable: true
    },
    news: {
        uri: ['v1', 'page', 'news'],
        date: false,
        renewable: false
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

    _makeFeedRequests(hyper, req, dateArr, isHistoric) {
        const props = {};
        const rp = req.params;
        let parts = Object.keys(PARTS_URIS);
        if (isHistoric) {
            parts = parts.filter((part) => PARTS_URIS[part].renewable);
        }
        parts.forEach((part) => {
            const def = PARTS_URIS[part];
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
