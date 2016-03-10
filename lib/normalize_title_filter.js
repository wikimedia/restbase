"use strict";

var HyperSwitch = require('hyperswitch');
var mwUtil = require('./mwUtil');
var HTTPError = HyperSwitch.HTTPError;
var Title = require('mediawiki-title').Title;

module.exports = function(hyper, req, next, options, specInfo) {
    var rp = req.params;
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
                if (result.getNamespace().isUser() || result.getNamespace().isUserTalk()) {
                    // Due to gender variations of User and User_Talk namespaces in some langs
                    // use canonical name for storage, but don't redirect. Don't cache either
                    rp.title = resultText;
                    return next(hyper, req)
                    .then(function(res) {
                        if (res) {
                            res.headers = res.headers || {};
                            res.headers['cache-control'] = 'no-cache, must-revalidate';
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
                            res.headers['cache-control'] = 'no-cache, must-revalidate';
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
