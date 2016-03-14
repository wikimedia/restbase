"use strict";

var HyperSwitch = require('hyperswitch');
var mwUtil = require('./mwUtil');
var HTTPError = HyperSwitch.HTTPError;
var Title = require('mediawiki-title').Title;

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

    if (rp.title) {
        return mwUtil.getSiteInfo(hyper, req)
        .then(function(siteInfo) {
            return Title.newFromText(rp.title, siteInfo);
        })
        .catch(function(e) {
            throw new HTTPError({
                status: 400,
                body: {
                    type: 'bad_request',
                    detail: e.message
                }
            });
        })
        .then(function(result) {
            var resultText = result.getPrefixedDBKey();
            if (resultText !== rp.title) {
                if (req.method === 'post' // Don't redirect POSTs as it's not cached anyway
                        || result.getNamespace().isUser()
                        || result.getNamespace().isUserTalk()) {
                    // Due to gender variations of User and User_Talk namespaces in some langs
                    // use canonical name for storage, but don't redirect. Don't cache either
                    rp.title = resultText;
                    return next(hyper, req)
                    .then(function(res) {
                        if (res) {
                            res.headers = res.headers || {};
                            res.headers['cache-control'] = 'no-cache';
                        }
                        return res;
                    });
                } else {
                    /* TODO: we don't want to enable redirects yet, so log the redirect instead
                     and disable caching of the response

                     rp.title = result;
                     var pathBeforeTitle = specInfo.path
                     .substring(0, specInfo.path.indexOf('{title}'));
                     pathBeforeTitle = new URI(pathBeforeTitle, rp, true).toString();
                     var pathAfterTitle = req.uri.toString().replace(pathBeforeTitle, '');
                     var backCount = (pathAfterTitle.match(/\//g) || []).length;
                     var backString = Array.apply(null, { length: backCount }).map(function() {
                     return '../';
                     }).join('');
                     var pathPatternAfterTitle = specInfo.path
                     .substring(specInfo.path.indexOf('{title}') - 1);
                     var contentLocation = backString
                     + new URI(pathPatternAfterTitle, rp, true).toString().substr(1);
                     return P.resolve({
                     status: 301,
                     headers: {
                     location: contentLocation
                     }
                     });*/
                    if (rp.title.replace(/ /g, '_') !== resultText) {
                        // Log all of these, should be relatively rare.
                        hyper.log('warn/normalize/non_space', {
                            msg: 'Normalized non-space chars',
                            from: rp.title,
                            to: resultText,
                        });
                    } else if (Math.random() < 0.05) {
                        // 5% chance of logging to bound volume.
                        hyper.log('warn/normalize/space', {
                            msg: 'Normalized requested title',
                            from: rp.title,
                            to: resultText,
                        });
                    }
                    return next(hyper, req)
                    .then(function(res) {
                        if (res) {
                            res.headers = res.headers || {};
                            res.headers['cache-control'] = 'no-cache';
                        }
                        return res;
                    });
                }
            } else {
                return next(hyper, req);
            }
        });
    } else {
        return next(hyper, req);
    }
};
