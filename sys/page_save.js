'use strict';


/**
 * Page_save module
 *
 * Sends the HTML or wikitext of a page to the MW API for saving
 */


var P = require('bluebird');
var HyperSwitch = require('hyperswitch');
var URI = HyperSwitch.URI;
var HTTPError = HyperSwitch.HTTPError;
var mwUtil = require('../lib/mwUtil');
var TimeUuid = require('cassandra-uuid').TimeUuid;

function PageSave() {
    var self = this;
    this.spec = {
        paths: {
            '/wikitext/{title}': {
                post: {
                    operationId: 'saveWikitext'
                }
            },
            '/html/{title}': {
                post: {
                    operationId: 'saveHTML'
                }
            }
        }
    };
    this.operations = {
        saveWikitext: self.saveWikitext.bind(self),
        saveHTML: self.saveHtml.bind(self)
    };
}

PageSave.prototype._getStartTimestamp = function(req) {
    if (req.headers && req.headers['if-match']) {
        var etag = mwUtil.parseETag(req.headers['if-match']);
        if (!etag || !TimeUuid.test(etag.tid) || !/^(?:[0-9]+)$/.test(etag.rev)) {
            throw new HTTPError({
                status: 400,
                body: {
                    type: 'bad_request',
                    title: 'Bad ETag in If-Match',
                    description: 'The supplied base_etag is invalid'
                }
            });
        } else {
            return TimeUuid.fromString(etag.tid).getDate().toISOString();
        }
    }
    return undefined;
};

PageSave.prototype._getBaseRevision = function(req) {
    if (req.body.base_etag) {
        var etag = mwUtil.parseETag(req.body.base_etag);
        if (etag) {
            return etag.rev;
        } else {
            throw new HTTPError({
                status: 400,
                body: {
                    type: 'bad_request',
                    title: 'Bad base_etag',
                    description: 'The supplied base_etag is invalid'
                }
            });
        }
    }
    return undefined;
};

PageSave.prototype._getRevInfo = function(hyper, req, revision) {
    var rp = req.params;
    var path = [rp.domain, 'sys', 'page_revisions', 'page', rp.title];
    if (!/^(?:[0-9]+)$/.test(revision)) {
        throw new HTTPError({
            status: 400,
            body: {
                type: 'bad_request',
                title: 'Bad revision',
                description: 'The supplied revision ID is invalid'
            }
        });
    }
    path.push(revision);
    return hyper.get({
        uri: new URI(path)
    })
    .then(function(res) {
        return res.body.items[0];
    }).catch({ status: 403 }, function() {
        // We are dealing with a restricted revision
        // however, let MW deal with it as the user
        // might have sufficient permissions to do an edit
        return { title: rp.title };
    });
};

PageSave.prototype._checkParams = function(params) {
    if (!(params && params.csrf_token &&
            ((params.wikitext && params.wikitext.trim()) || (params.html && params.html.trim()))
    )) {
        throw new HTTPError({
            status: 400,
            body: {
                type: 'bad_request',
                title: 'Missing parameters',
                description: 'The html/wikitext and csrf_token parameters are required'
            }
        });
    }
};

PageSave.prototype.saveWikitext = function(hyper, req) {
    var self = this;
    var rp = req.params;
    var promise = P.resolve({});
    this._checkParams(req.body);
    var baseRevision = this._getBaseRevision(req);
    if (baseRevision) {
        promise = this._getRevInfo(hyper, req, baseRevision);
    }
    return promise.then(function(revInfo) {
        var body = {
            title: rp.title,
            text: req.body.wikitext,
            summary: req.body.comment || req.body.wikitext.substr(0, 100),
            minor: !!req.body.is_minor,
            bot: !!req.body.is_bot,
            token: req.body.csrf_token
        };
        // We need to add each info separately
        // since the presence of an empty value
        // might startle the MW API
        if (revInfo.rev) {
            // For forward compat with https://gerrit.wikimedia.org/r/#/c/94584
            body.parentrevid = revInfo.rev;
        }
        if (revInfo.timestamp) {
            // TODO: remove once the above patch gets merged
            body.basetimestamp = revInfo.timestamp;
        }
        body.starttimestamp = self._getStartTimestamp(req);
        return hyper.post({
            uri: new URI([rp.domain, 'sys', 'action', 'edit']),
            headers: {
                cookie: req.headers.cookie
            },
            body: body
        });
    });
};

PageSave.prototype.saveHtml = function(hyper, req) {
    var self = this;
    var rp = req.params;
    this._checkParams(req.body);
    // First transform the HTML to wikitext via the parsoid module
    var path = [rp.domain, 'sys', 'parsoid', 'transform', 'html', 'to', 'wikitext', rp.title];
    var baseRevision = this._getBaseRevision(req);
    if (baseRevision) {
        path.push(baseRevision);
    }
    return hyper.post({
        uri: new URI(path),
        body: {
            html: req.body.html
        },
        headers: {
            'if-match': req.body.base_etag || req.headers['if-match']
        }
    })
    .then(function(res) {
        // Then send it to the MW API
        req.body.wikitext = res.body;
        delete req.body.html;
        return self.saveWikitext(hyper, req);
    });
};


module.exports = function(options) {
    var ps = new PageSave(options || {});
    return {
        spec: ps.spec,
        operations: ps.operations
    };
};


