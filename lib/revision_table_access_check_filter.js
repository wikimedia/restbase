"use strict";

// TODO: This is a temp solution that will
// be eventually replaced by the restrictions table.

const URI = require('hyperswitch').URI;
const mwUtil = require('./mwUtil');
const P = require('bluebird');

function redirect(content, location, options) {
    const vary = content.headers.vary ? `${content.headers.vary}, origin` : 'origin';
    return {
        status: 302,
        headers: Object.assign(content.headers, {
            location,
            'cache-control': options.redirect_cache_control || 'no-cache',
            vary
        }),
        body: content.body
    };
}

module.exports = (hyper, req, next, options, specInfo) => {
    const rp = req.params;
    const titleParamName = options.title ? options.title : 'title';
    const checkURIParts = [rp.domain, 'sys', 'page_revisions', 'page', rp[titleParamName]];
    if (rp.revision) {
        checkURIParts.push(`${rp.revision}`);
    }

    return hyper.get({ uri: new URI(checkURIParts) })
    .then((res) => {
        const revision = res.body.items[0];

        if (revision.redirect
                && req.query.redirect !== false
                && !mwUtil.isNoCacheRequest(req)) {
            const htmlPath = [rp.domain, 'sys', 'parsoid', 'html', rp[titleParamName]];
            if (rp.revision) {
                htmlPath.push(`${rp.revision}`);
                if (rp.tid) {
                    htmlPath.push(`${rp.tid}`);
                }
            }
            return hyper.get({
                uri: new URI(htmlPath),
            })
            .then((html) => {
                const redirectTitle = mwUtil.extractRedirect(html.body)
                    // Redirect detected while saving new HTML.
                    || html.headers.location;
                if (redirectTitle) {
                    const newParams = Object.assign({}, rp);
                    newParams[titleParamName] = redirectTitle;
                    const location = mwUtil.createRelativeTitleRedirect(specInfo.path, req, {
                        newReqParams: newParams,
                        titleParamName,
                        dropPathAfterTitle: true,
                    });

                    let contentPromise;
                    if (options.attach_body_to_redirect) {
                        if (specInfo.path.indexOf('html') !== -1) {
                            contentPromise = P.resolve(html);
                        } else {
                            contentPromise = next(hyper, req);
                        }
                    } else {
                        contentPromise = P.resolve({
                            headers: {
                                etag: html.headers.etag
                            }
                        });
                    }

                    return contentPromise.then((content) => redirect(content, location, options));
                } else {
                    return next(hyper, req);
                }
            });
        }
        return next(hyper, req)
        .then((res) => {
            if (res.status === 302
                    && (req.query.redirect === false || mwUtil.isNoCacheRequest(req))) {
                res.status = 200;
                delete res.headers.location;
            }
            return res;
        });
    });
};
