"use strict";

// TODO: This is a temp solution that will
// be eventually replaced by the restrictions table.

var URI = require('hyperswitch').URI;
var mwUtil = require('./mwUtil');
var entities = require('entities');

var redirectRegEx = /<link rel="mw:PageProp\/redirect" href="\.\/([^"#]+)(?:#[^"]*)?"/;

module.exports = function(hyper, req, next, options, specInfo) {
    var rp = req.params;
    var titleName = options.title ? options.title : 'title';
    var checkURIParts = [rp.domain, 'sys', 'page_revisions', 'page', rp[titleName]];
    if (rp.revision) {
        checkURIParts.push('' + rp.revision);
    }

    return hyper.get({ uri: new URI(checkURIParts) })
    .then(function(res) {
        var revision = res.body.items[0];

        if (revision.redirect && req.query.redirect !== false) {
            var htmlPath = [rp.domain, 'sys', 'parsoid', 'html', rp[titleName]];
            if (rp.revision) {
                htmlPath.push('' + rp.revision);
            }
            return hyper.get({ uri: new URI(htmlPath) })
            .then(function(res) {
                var html = res.body;
                var redirectMatch = redirectRegEx.exec(html);
                if (redirectMatch) {
                    var newParams = Object.assign({}, rp);
                    newParams[titleName] = decodeURIComponent(entities.decodeXML(redirectMatch[1]));
                    var location = mwUtil.createRelativeTitleRedirect(specInfo.path, req,
                        newParams, titleName);
                    return next(hyper, req).then(function(res) {
                        return {
                            status: 302,
                            headers: Object.assign(res.headers, {
                                location: location,
                                'cache-control': options.redirect_cache_control || 'no-cache'
                            }),
                            body: res.body
                        };
                    });
                } else {
                    return next(hyper, req);
                }
            });
        }
        return next(hyper, req);
    });
};
