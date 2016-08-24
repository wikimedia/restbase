"use strict";

var mwUtil = require('./mwUtil');
var P = require('bluebird');
var URI = require('hyperswitch').URI;

module.exports = function(hyper, req, next) {
    var rp = req.params;
    var checkURIParts = [rp.domain, 'sys', 'page_revisions', 'restriction', rp.title];
    if (rp.revision) {
        checkURIParts.push(rp.revision);
    }

    return P.join(
        next(hyper, req),
        hyper.get({ uri: new URI(checkURIParts) })
    )
    .spread(function(content, restriction) {
        if (restriction.body && restriction.body.items && restriction.body.items.length) {
            var revInfo = mwUtil.parseETag(content.headers.etag);
            mwUtil.applyAccessChecks(restriction.body.items[0], revInfo.rev);
        }
        return content;
    });
};
