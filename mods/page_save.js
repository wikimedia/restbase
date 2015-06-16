'use strict';


/**
 * page_save module
 *
 * Sends the HTML or wikitext of a page to the MW API for saving
 */


var P = require('bluebird');
var URI = require('swagger-router').URI;
var rbUtil = require('../lib/rbUtil');


function PageSave(options) {
    var self = this;
    this.log = options.log || function() {};
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

PageSave.prototype._getRevInfo = function(restbase, req) {
    var rp = req.params;
    var path = [rp.domain,'sys','page_revisions','page',
                         rbUtil.normalizeTitle(rp.title)];
    if (!/^(?:[0-9]+)$/.test(req.body.revision)) {
        throw new rbUtil.HTTPError({
            status: 400,
            body: {
                type: 'invalid_request',
                title: 'Bad revision',
                description: 'The supplied revision ID is invalid'
            }
        });
    }
    path.push(req.body.revision);
    return restbase.get({
        uri: new URI(path)
    })
    .then(function(res) {
        return res.body.items[0];
    }).catch(function(err) {
        if(err.status !== 403) {
            throw err;
        }
        // we are dealing with a restricted revision
        // however, let MW deal with it as the user
        // might have sufficient permissions to do an edit
        return {title: rbUtil.normalizeTitle(rp.title)};
    });
};

PageSave.prototype._checkParams = function(params) {
    if(!(params && params.token &&
            ((params.wikitext && params.wikitext.trim()) || (params.html && params.html.trim()))
    )) {
        throw new rbUtil.HTTPError({
            status: 400,
            body: {
                type: 'invalid_request',
                title: 'Missing parameters',
                description: 'The html/wikitext and token parameters are required'
            }
        });
    }
};

PageSave.prototype.saveWikitext = function(restbase, req) {
    var rp = req.params;
    var title = rbUtil.normalizeTitle(rp.title);
    var promise = P.resolve({});
    this._checkParams(req.body);
    if(req.body.revision) {
        promise = this._getRevInfo(restbase, req);
    }
    return promise.then(function(revInfo) {
        var body = {
            title: title,
            text: req.body.wikitext,
            summary: req.body.comment || 'Change text to: ' + req.body.wikitext.substr(0, 100),
            minor: req.body.minor || false,
            bot: req.body.bot || false,
            token: req.body.token
        };
        // we need to add each info separately
        // since the presence of an empty value
        // might startle the MW API
        if(revInfo.rev) {
            // for forward compat with https://gerrit.wikimedia.org/r/#/c/94584
            body.parentrevid = revInfo.rev;
        }
        if(revInfo.timestamp) {
            // TODO: remove once the above patch gets merged
            body.basetimestamp = revInfo.timestamp;
        }
        return restbase.post({
            uri: new URI([rp.domain, 'sys', 'action', 'edit']),
            headers: {
                cookie: req.headers.cookie
            },
            body: body
        });
    });
};

PageSave.prototype.saveHtml = function(restbase, req) {
    var self = this;
    var rp = req.params;
    var title = rbUtil.normalizeTitle(rp.title);
    var promise = P.resolve({});
    this._checkParams(req.body);
    // first transform the HTML to wikitext via the parsoid module
    return restbase.post({
        uri: new URI([rp.domain, 'sys', 'parsoid', 'transform', 'html', 'to', 'wikitext', title]),
        body: {
            revision: req.body.revision,
            html: req.body.html
        }
    }).then(function(res) {
        // then send it to the MW API
        req.body.wikitext = res.body;
        delete req.body.html;
        return self.saveWikitext(restbase, req);
    });
};


module.exports = function(options) {
    var ps = new PageSave(options || {});
    return {
        spec: ps.spec,
        operations: ps.operations
    };
};

