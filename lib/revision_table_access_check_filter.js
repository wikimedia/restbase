"use strict";

// TODO: This is a temp solution that will
// be eventually replaced by the restrictions table.

var URI = require('hyperswitch').URI;
var mwUtil = require('./mwUtil');
var P = require('bluebird');
var entities = require('entities');


module.exports = function(hyper, req, next, options, specInfo) {
    var rp = req.params;
    var titleParamName = options.title ? options.title : 'title';
    var checkURIParts = [rp.domain, 'sys', 'page_revisions', 'page', rp[titleParamName]];
    if (rp.revision) {
        checkURIParts.push('' + rp.revision);
    }

    return hyper.get({ uri: new URI(checkURIParts) })
    .then(function(res) {
        var revision = res.body.items[0];

        if (revision.redirect
                && req.query.redirect !== false
                && !mwUtil.isNoCacheRequest(req)) {
            var htmlPath = [rp.domain, 'sys', 'parsoid', 'html', rp[titleParamName]];
            if (rp.revision) {
                htmlPath.push('' + rp.revision);
                if (rp.tid) {
                    htmlPath.push('' + rp.tid);
                }
            }
            return hyper.get({
                uri: new URI(htmlPath),
            })
            .then(function(html) {
                var redirectTitle = mwUtil.extractRedirect(html.body)
                    // Redirect detected while saving new HTML.
                    || html.headers.location;
                if (redirectTitle) {
                    var newParams = Object.assign({}, rp);
                    newParams[titleParamName] = redirectTitle;
                    var location = mwUtil.createRelativeTitleRedirect(specInfo.path, req, {
                        newReqParams: newParams,
                        titleParamName: titleParamName,
                        dropPathAfterTitle: true,
                    });

                    var contentPromise;
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

                    if (mwUtil.isSelfRedirect(req, location)) {
                        location = mwUtil.addQueryString(location, { redirect: false });
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
                } else {
                    return next(hyper, req);
                }
            });
        }
        return next(hyper, req)
        .then(function(res) {
            if (req.query.redirect === false || mwUtil.isNoCacheRequest(req)) {
                res.status = 200;
                delete res.headers.location;
            }
            return res;
        });
    });
};
