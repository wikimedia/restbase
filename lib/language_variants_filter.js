"use strict";

const HyperSwitch = require('hyperswitch');
const URI = HyperSwitch.URI;
const mwUtil = require('./mwUtil');

module.exports = (hyper, req, next, options, specInfo) => {
    const rp = req.params;
    const acceptLanguage = req.headers && req.headers['accept-language'];
    if (!acceptLanguage || mwUtil.isNoCacheRequest(req)) {
        delete req.headers['accept-language'];
        return next(hyper, req);
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
                return next(hyper, req);
            }

            if (/\/page\/html\//.test(specInfo.path)) {
                // It's HTML, hit Parsoid for conversion
                return next(hyper, req)
                .then(html => hyper.post({
                    uri: new URI([rp.domain, 'sys', 'parsoid', 'transform', 'html', 'to', 'html']),
                    headers: {
                        'content-type': 'application/json',
                        'content-language': revision.page_language
                    },
                    body: {
                        original: {
                            html: {
                                headers: html.headers,
                                body: html.body.toString()
                            }
                        },
                        updates: {
                            variant: {
                                source: null,
                                target: acceptLanguage
                            }
                        }
                    }
                }));
                // We can skip setting Vary: accept-language as Parsoid sets it.
            } else {
                // TODO: It's something else, so just forward to MCS
                return next(hyper, req);
            }
        });
    });
};
