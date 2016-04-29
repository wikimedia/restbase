"use strict";

var HyperSwitch = require('hyperswitch');
var HTTPError = HyperSwitch.HTTPError;
var mwUtil = require('./mwUtil');
var P = require('bluebird');

module.exports = function(hyper, req, next, options, specInfo) {
    var rp = req.params;
    /**
     * Temporary hint response for rest.wikimedia.org requests.
     */
    if (req.headers.host && req.headers.host === 'rest.wikimedia.org') {
        if (Math.random() < 0.1) {
            hyper.log('warn/normalize/rest_wikimedia_org', {
                msg: 'Request to rest.wikimedia.org',
            });
        }

        // Satisfy jscs's 100 char limit
        var mURL = 'https://lists.wikimedia.org/pipermail/mediawiki-api/2016-January/003691.html';
        throw new HTTPError({
            status: 410,
            body: {
                type: 'gone',
                title: 'This entry point is gone.',
                description: 'The rest.wikimedia.org entry point has been replaced with'
                    + ' /api/rest_v1/ at the main project domains. See '
                    + mURL + '.',
            }
        });
    }
    if (!rp.title) {
        return next(hyper, req);
    }

    return mwUtil.normalizeTitle(hyper, req, rp.title)
    .then(function(normalizeResult) {
        var resultText = normalizeResult.getPrefixedDBKey();
        if (resultText !== rp.title) {
            rp.title = resultText;
            if (req.method === 'post' // Don't redirect POSTs as it's not cached anyway
                    || normalizeResult.getNamespace().isUser()
                    || normalizeResult.getNamespace().isUserTalk()
                    || mwUtil.isNoCacheRequest(req)) {
                // Due to gender variations of User and User_Talk namespaces in some langs
                // use canonical name for storage, but don't redirect. Don't cache either
                // For no-cache update requests we don't want to redirect in general
                return next(hyper, req)
                .then(function(res) {
                    if (res) {
                        res.headers = res.headers || {};
                        res.headers['cache-control'] = 'no-cache';
                    }
                    return res;
                });
            } else {
                return P.resolve({
                    status: 301,
                    headers: {
                        location: mwUtil.createRelativeTitleRedirect(specInfo.path, req),
                        'cache-control': options.redirect_cache_control || 'no-cache'
                    }
                });
            }
        }
        if (normalizeResult.getNamespace().isFile() && req.query.redirect !== false) {
            return next(hyper, req).catch({ status: 404 }, function(e) {
                return mwUtil.getSiteInfo(hyper, req)
                .then(function(siteInfo) {
                    if (siteInfo.sharedRepoRootURI && !mwUtil.isNoCacheRequest(req)) {
                        // It's a file page and it might be in the shared repo.
                        // Redirect.
                        var redirectPath = req.uri + '';
                        redirectPath = redirectPath.substr(redirectPath.indexOf('v1') + 2);
                        redirectPath = siteInfo.sharedRepoRootURI + '/api/rest_v1'
                            + redirectPath + mwUtil.getQueryString(req);
                        return {
                            status: 302,
                            headers: {
                                location: redirectPath,
                                'cache-control': options.redirect_cache_control || 'no-cache'
                            }
                        };
                    } else {
                        throw e;
                    }
                });
            });
        }
        return next(hyper, req);
    });
};
