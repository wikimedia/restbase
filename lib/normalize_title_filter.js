"use strict";

var HyperSwitch = require('hyperswitch');
var mwUtil = require('./mwUtil');
var HTTPError = HyperSwitch.HTTPError;
var URI = HyperSwitch.URI;
var Title = require('mediawiki-title').Title;
var P = require('bluebird');

function normalizeTitle(title, siteInfo) {
    return P.try(function() {
        return Title.newFromText(title, siteInfo);
    })
    .catch(function(e) {
        throw new HTTPError({
            status: 400,
            body: {
                type: 'bad_request',
                detail: e.message
            }
        });
    });
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

    var nextRequest;
    if (!rp.title) {
        return next(hyper, req);
    }

    return mwUtil.getSiteInfo(hyper, req)
    .then(function(siteInfo) {
        return normalizeTitle(rp.title, siteInfo)
        .then(function(result) {
            var resultText = result.getPrefixedDBKey();
            if (resultText !== rp.title) {
                rp.title = resultText;
                if (req.method === 'post' // Don't redirect POSTs as it's not cached anyway
                        || result.getNamespace().isUser()
                        || result.getNamespace().isUserTalk()) {
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
                    var pathBeforeTitle = specInfo.path
                        .substring(0, specInfo.path.indexOf('{title}'));
                    pathBeforeTitle = new URI(pathBeforeTitle, rp, true).toString();
                    // Omit the domain prefix as it could be wrong for node shared between domains
                    pathBeforeTitle = pathBeforeTitle.replace(/^\/[^\/]+\//, '');
                    var pathSuffix = req.uri.toString()
                        .replace(/\/[^\/]+\//, '')
                        .replace(pathBeforeTitle, '');
                    var pathSuffixCount = (pathSuffix.match(/\//g) || []).length;
                    var backString = Array.apply(null, { length: pathSuffixCount }).map(function() {
                        return '../';
                    }).join('');
                    var pathPatternAfterTitle = specInfo.path
                        .substring(specInfo.path.indexOf('{title}') - 1);
                    var contentLocation = backString
                        + new URI(pathPatternAfterTitle, rp, true).toString().substr(1);
                    return P.resolve({
                        status: 301,
                        headers: {
                            location: contentLocation,
                            'cache-control': options.redirect_cache_control || 'no-cache'
                        }
                    });
                }
            }
            if (result.getNamespace().isFile() && siteInfo.sharedRepoRootURI) {
                return next(hyper, req).catch({ status: 404 }, function() {
                    // It's a file page and it might be in the shared repo.
                    // Redirect.
                    var redirectPath = req.uri + '';
                    redirectPath = redirectPath.substr(redirectPath.indexOf('v1') + 2);
                    redirectPath = siteInfo.sharedRepoRootURI + '/api/rest_v1' + redirectPath;
                    return {
                        status: 301,
                        headers: {
                            location: redirectPath,
                            'cache-control': options.redirect_cache_control || 'no-cache'
                        }
                    };
                });
            }
            return next(hyper, req);
        });
    });
};
