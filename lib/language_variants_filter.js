'use strict';

const HyperSwitch = require('hyperswitch');
const URI = HyperSwitch.URI;
const mwUtil = require('./mwUtil');

module.exports = (hyper, req, next, options, specInfo) => {
    const rp = req.params;
    const acceptLanguage = req.headers && req.headers['accept-language'];
    // TODO: investigate why the following block is not allowing related to forward
    // accept-language to summary request
    if (!acceptLanguage || mwUtil.isNoCacheRequest(req)) {
        delete req.headers['accept-language'];
        return next(hyper, req)
        // TODO: For now we hacky check by domain as the vary header is not stored for everything.
        .then((res) => {
            const langCode = req.params.domain.substring(0, req.params.domain.indexOf('.'));
            return mwUtil.canConvertLangVariant(hyper, req, langCode)
            .then((canConvert) => {
                if (canConvert) {
                    mwUtil.addVaryHeader(res, 'accept-language');
                }
            })
            .thenReturn(res);
        });
    }

    const revTableURI = [rp.domain, 'sys', 'page_revisions', 'page', rp.title];
    if (rp.revision) {
        revTableURI.push(`${rp.revision}`);
    }
    return hyper.get({ uri: new URI(revTableURI) })
    .then((res) => {
        const revision = res.body.items[0];
        return mwUtil.shouldConvertLangVariant(hyper, req, revision.page_language, acceptLanguage)
        .then((shouldConvert) => {
            if (!shouldConvert) {
                delete req.headers['accept-language'];
                return next(hyper, req)
                .then((res) => mwUtil.canConvertLangVariant(hyper, req, revision.page_language)
                .then((canConvert) => {
                    // TODO: For now we hacky check by domain as the vary header
                    // is not stored for everything.
                    if (canConvert) {
                        mwUtil.addVaryHeader(res, 'accept-language');
                    }
                })
                .thenReturn(res));
            }

            if (mwUtil.isHTMLRoute(specInfo.path)) {
                // It's HTML, hit Parsoid for conversion
                const parsoidUri = new URI([rp.domain,
                    'sys', 'parsoid', 'transform', 'html', 'to', 'html', rp.title]);
                return next(hyper, req)
                .then((htmlRes) => hyper.post({
                    uri: parsoidUri,
                    headers: {
                        'content-type': 'application/json',
                        'content-language': revision.page_language
                    },
                    body: {
                        original: {
                            html: {
                                headers: htmlRes.headers,
                                body: htmlRes.body.toString()
                            }
                        },
                        updates: {
                            variant: {
                                source: null,
                                target: acceptLanguage
                            }
                        }
                    }
                })
                .then((res) => {
                    // Parsoid transformation doesn't know about our caching policies
                    // or additional headers RESTBase sets, so merge headers from the original
                    // and important headers from the transformation.
                    const resHeaders = res.headers;
                    res.headers = htmlRes.headers;
                    res.headers.vary = resHeaders.vary;
                    res.headers['content-language'] = resHeaders['content-language'];
                    return res;
                }));
            } else {
                // TODO: Eventually we want to think of a better way to support
                // other content pure-fetching, but right now let's use a magic
                // header.
                req.headers['cache-control'] = 'no-cache,no-store';
                return next(hyper, req);
            }
        });
    });
};
