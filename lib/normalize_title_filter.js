"use strict";

var HyperSwitch = require('hyperswitch');
var mwUtil = require('./mwUtil');
var URI = HyperSwitch.URI;
var P = require('bluebird');

function getQueryString(req) {
    if (Object.keys(req.query).length) {
        return '?' + querystring.stringify(req.query);
    }
    return '';
}

module.exports = function(hyper, req, next, options, specInfo) {
    var rp = req.params;
    /**
     * Temporary logging & handling for rest.wikimedia.org requests.
     */
    if (req.headers.host && req.headers.host === 'rest.wikimedia.org') {
        // 1:10 sampled logging until we know that the rate is really low.
        if (Math.random() < 0.1) {
            hyper.log('warn/normalize/rest_wikimedia_org', {
                msg: 'Request to rest.wikimedia.org',
            });
        }
        var origNext = next;
        // Make sure no rest.wikimedia.org requests are cached, as they aren't
        // purged in Varnish frontends.
        next = function(hyper, req) {
            return origNext(hyper, req)
            .then(function(res) {
                if (res) {
                    res.headers = res.headers || {};
                    res.headers['cache-control'] = 'no-cache';
                }
                return res;
            });
        };
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
                    || normalizeResult.getNamespace().isUserTalk()) {
                // Due to gender variations of User and User_Talk namespaces in some langs
                // use canonical name for storage, but don't redirect. Don't cache either
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
        if (normalizeResult.getNamespace().isFile()
                // Temporarily limit file descripiton redirects to the app,
                // until https://phabricator.wikimedia.org/T130757 (VE
                // redirect support) is resolved.
                // TODO: Remove.
                && /^WikipediaApp\//.test(req.headers['user-agent'])
                && req.query.redirect !== 'no') {
            return next(hyper, req).catch({ status: 404 }, function(e) {
                return mwUtil.getSiteInfo(hyper, req)
                .then(function(siteInfo) {
                    if (siteInfo.sharedRepoRootURI) {
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
