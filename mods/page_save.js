'use strict';


/**
 * page_save module
 *
 * Sends the wikitext of a page to the MW API for saving
 */


var P = require('bluebird');
var URI = require('swagger-router').URI;
var rbUtil = require('../lib/rbUtil');


function PageSave(options) {
    var self = this;
    this.log = options.log || function() {};
    this.spec = {
        paths: {
            '/wikitext/{title}{/revision}': {
                post: {
                    operationId: 'saveWikitext'
                }
            }
        }
    };
    this.operations = {
        saveWikitext: self.saveWikitext.bind(self)
    };
}

PageSave.prototype._getRevInfo = function(restbase, req) {
    var rp = req.params;
    var path = [rp.domain,'sys','page_revisions','page',
                         rbUtil.normalizeTitle(rp.title)];
    if (!/^(?:[0-9]+)$/.test(rp.revision)) {
        throw new Error("Invalid revision: " + rp.revision);
    }
    path.push(rp.revision);
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
    if(!(params && params.text && params.text.trim() && params.token)) {
        throw new rbUtil.HTTPError({
            status: 400,
            body: {
                type: 'invalid_request',
                title: 'Missing parameters',
                description: 'The text and token parameters are required'
            }
        });
    }
};

PageSave.prototype.saveWikitext = function(restbase, req) {
    var rp = req.params;
    var promise;
    this._checkParams(req.body);
    promise = P.resolve({
        title: rbUtil.normalizeTitle(rp.title)
    });
    if(rp.revision) {
        promise = this._getRevInfo(restbase, req);
    }
    return promise.then(function(revInfo) {
        var body = {
            title: revInfo.title,
            text: req.body.text,
            summary: req.body.summary || 'Change text to: ' + req.body.text.substr(0, 100),
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
    }).then(function(res) {
        res.status = 201;
        return res;
    });
};



module.exports = function(options) {
    var ps = new PageSave(options || {});
    return {
        spec: ps.spec,
        operations: ps.operations
    };
};

