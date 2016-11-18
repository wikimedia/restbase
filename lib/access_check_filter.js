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
            const revInfo = mwUtil.parseETag(content.headers.etag);

            if (restriction && restriction.body) {
                mwUtil.applyAccessChecks(restriction.body, revInfo.rev);
            }

            // Use redirect target from restrictions table or content response.
            const redirectTarget = restriction && restriction.body
                && parseInt(revInfo.rev, 10) === parseInt(restriction.body.rev, 10)
                && restriction.body.redirect || content.headers.location;
            if (redirectTarget
                    && req.query.redirect !== false
                    && !mwUtil.isNoCacheRequest(req)) {
                const newParams = Object.assign({}, rp);
                newParams[titleParamName] = redirectTarget;
                const location = mwUtil.createRelativeTitleRedirect(specInfo.path,
                    req, {
                        newReqParams: newParams,
                        titleParamName,
                        dropPathAfterTitle: true,
                    });

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

                return contentPromise.then(content => redirect(content, location, options));
            } else if (content.status === 302) {
                content.status = 200;
                delete content.headers.location;
            }
        }
        return content;
    });
};
