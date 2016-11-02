'use strict';

const mwUtil = require('./mwUtil');
const P = require('bluebird');
const URI = require('hyperswitch').URI;

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

function response(hyper, req, path, titleParamName, location) {
    const pathBeforeTitle = path.substring(0, path.indexOf(`{${titleParamName}}`));
    const contentLocation = new URI(pathBeforeTitle, req.params, true).toString() + location;
    return hyper.request({
        method: req.method,
        uri: new URI(contentLocation),
        headers: req.headers,
        body: req.body
    })
    .tap((res) => {
        res.headers = res.headers || {};
        res.headers['cache-control'] = 'no-cache';
        res.headers.vary = res.headers.vary ? `${res.headers.vary}, origin` : 'origin';
    });
}

module.exports = (hyper, req, next, options, specInfo) => {
    const rp = req.params;
    const titleParamName = options.title || 'title';
    const checkURIParts = [rp.domain, 'sys', 'page_revisions', 'restrictions', rp.title];
    if (rp.revision) {
        checkURIParts.push(`${rp.revision}`);
    }

    return P.join(
        next(hyper, req),
        hyper.get({ uri: new URI(checkURIParts) })
        .catch({ status: 404 }, () => null)
    )
    .spread((content, restriction) => {
        if (restriction || content.headers.location) {
            if (restriction && restriction.body) {
                const revInfo = mwUtil.parseETag(content.headers.etag);
                mwUtil.applyAccessChecks(restriction.body, revInfo.rev);
            }

            // Use redirect target from restrictions table or content response.
            const redirectTarget = restriction && restriction.body
                && restriction.body.redirect || content.headers.location;
            if (redirectTarget
                    && req.query.redirect !== false
                    && !mwUtil.isNoCacheRequest(req)) {
                const newParams = Object.assign({}, rp);
                newParams[titleParamName] = redirectTarget;
                const location = mwUtil.createRelativeTitleRedirect(specInfo.path,
                    req, redirectTarget, {
                        titleParamName,
                        dropPathAfterTitle: true,
                    });

                let contentPromise;
                if (options.attach_body_to_redirect || mwUtil.isCrossOrigin(req)) {
                    contentPromise = P.resolve(content);
                } else {
                    contentPromise = P.resolve({
                        headers: {
                            etag: content.headers.etag
                        }
                    });
                }

                return contentPromise.then((content) => {
                    if (mwUtil.isCrossOrigin(req)) {
                        return response(hyper, req, specInfo.path, titleParamName, location);
                    } else {
                        return redirect(content, location, options);
                    }
                });
            }
        }
        return content;
    });
};
