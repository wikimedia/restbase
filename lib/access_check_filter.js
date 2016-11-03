'use strict';

const mwUtil = require('./mwUtil');
const P = require('bluebird');
const URI = require('hyperswitch').URI;

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
                let location = mwUtil.createRelativeTitleRedirect(specInfo.path,
                    req, {
                        newReqParams: newParams,
                        titleParamName,
                        dropPathAfterTitle: true,
                    });

                if (mwUtil.isSelfRedirect(req, location)) {
                    location = mwUtil.addQueryString(location, { redirect: false });
                }

                let contentPromise;
                if (options.attach_body_to_redirect) {
                    contentPromise = P.resolve(content);
                } else {
                    contentPromise = P.resolve({
                        headers: {
                            etag: content.headers.etag
                        }
                    });
                }
                return contentPromise.then((theContent) => ({
                    status: 302,
                    headers: Object.assign(theContent.headers, {
                        location,
                        'cache-control': options.redirect_cache_control || 'no-cache'
                    }),
                    body: theContent.body
                }));
            } else {
                delete content.headers.location;
            }
        }
        return content;
    });
};
