'use strict';


const P = require('bluebird');
const URI = require('hyperswitch').URI;
const mwUtil = require('./mwUtil');


module.exports = (hyper, req, next, options, specInfo) => {

    const rp = req.params;

    if (mwUtil.isNoCacheRequest(req) || rp.revision || rp.revision === 0) {
        // this is an update request or the client
        // provided a revision, so skip the check entirely
        return next(hyper, req);
    }

    return mwUtil.getSiteInfo(hyper, req).then((siteinfo) => {
        if (!siteinfo.extensions['Flagged Revisions']) {
            // the project does not have the FlaggedRevs extension
            // enabled so proceed as normal
            return next(hyper, req);
        }
        const queryReq = {
            uri: new URI([rp.domain, 'sys', 'action', 'query']),
            method: 'post',
            body: {
                prop: 'flagged',
                titles: rp.title,
                formatversion: 2
            }
        };
        return P.props({
            content: next(hyper, req),
            revinfo: hyper.post(queryReq).catch((e) => { return null; })
        }).then((res) => {
            const content = res.content;
            const retrev = mwUtil.parseETag(content.headers.etag).rev;
            const revinfo = res.revinfo && res.revinfo.body.items[0];
            if (!revinfo || !revinfo.flagged || revinfo.flagged.stable_revid === retrev) {
                // the page has no flagged revisions, or the client is
                // fetching a stable revision, so it's safe to return it
                return content;
            }
            // the client is not looking for a specific revision
            // so redo the request with the stable revision
            req.params.revision = revinfo.flagged.stable_revid;
            req.uri = new URI(`${req.uri.toString()}/${revinfo.flagged.stable_revid}`);
            return hyper.request(req);
        });
    });

};
