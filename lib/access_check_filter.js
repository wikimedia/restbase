'use strict';

var mwUtil = require('./mwUtil');
var P = require('bluebird');
var URI = require('hyperswitch').URI;

module.exports = function(hyper, req, next, options, specInfo) {
    var rp = req.params;
    var titleParamName = options.title ? options.title : 'title';
    var checkURIParts = [rp.domain, 'sys', 'page_revisions', 'restrictions', rp.title];
    if (rp.revision) {
        checkURIParts.push(rp.revision + '');
    }

    return P.join(
        next(hyper, req),
        hyper.get({ uri: new URI(checkURIParts) })
        .catch({ status: 404 }, function() {
            return null;
        })
    )
    .spread(function(content, restriction) {
        if (restriction || content.headers.location) {
            if (restriction && restriction.body) {
                var revInfo = mwUtil.parseETag(content.headers.etag);
                mwUtil.applyAccessChecks(restriction.body, revInfo.rev);
            }

            // Use redirect target from restrictions table or content response.
            var redirectTarget = restriction && restriction.body
                && restriction.body.redirect
                || content.headers.location;
            if (redirectTarget
                    && req.query.redirect !== false
                    && !mwUtil.isNoCacheRequest(req)) {
                var newParams = Object.assign({}, rp);
                newParams[titleParamName] = redirectTarget;
                var location = mwUtil.createRelativeTitleRedirect(specInfo.path,
                    req, {
                        newReqParams: newParams,
                        titleParamName: titleParamName,
                        dropPathAfterTitle: true,
                    });

                if (mwUtil.isSelfRedirect(req, location)) {
                    location = mwUtil.addQueryString(location, { redirect: false });
                }

                var contentPromise;
                if (options.attach_body_to_redirect) {
                    contentPromise = P.resolve(content);
                } else {
                    contentPromise = P.resolve({
                        headers: {
                            etag: content.headers.etag
                        }
                    });
                }
                return contentPromise.then(function(content) {
                    return {
                        status: 302,
                        headers: Object.assign(content.headers, {
                            location: location,
                            'cache-control': options.redirect_cache_control || 'no-cache'
                        }),
                        body: content.body
                    };
                });
            }
        }

        return content;
    });
};
