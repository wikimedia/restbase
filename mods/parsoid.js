'use strict';

/*
 * Simple wrapper for Parsoid
 */

var URI = require('swagger-router').URI;
var uuid   = require('node-uuid');
var rbUtil = require('../lib/rbUtil');

var contentTypes = {
    html: 'text/html; charset=UTF-8',
    'data-parsoid': 'application/json; profile=mediawiki.org/specs/data-parsoid/1.0'
};


function ParsoidService(options) {
    options = options || {};
    this.parsoidHost = options.parsoidHost
        || 'http://parsoid-lb.eqiad.wikimedia.org';
}

// Short alias
var PSP = ParsoidService.prototype;

PSP.getBucketURI = function(rp, format) {
    return new URI([rp.domain,'sys','key_value','parsoid.' + format,rp.title,rp.revision]);
};

PSP.pagebundle = function(restbase, req) {
    var rp = req.params;
    var uri = this.parsoidHost + '/v2/' + rp.domain + '/pagebundle/'
        + encodeURIComponent(rp.title) + '/' + rp.revision;
    console.log(uri);
    return restbase.get({ uri: uri });
};

PSP.saveParsoidResult = function (restbase, req, format, tid, parsoidResp) {
    var rp = req.params;
    // handle the response from Parsoid
    if (parsoidResp.status === 200) {
        parsoidResp.headers.etag = tid;
        Promise.all([
            restbase.put({
                uri: new URI([rp.domain,'sys','key_value','parsoid.html',rp.title,tid]),
                headers: rbUtil.extend({}, parsoidResp.headers, {
                    'content-type': contentTypes.html
                }),
                body: parsoidResp.body.html
            }),
            restbase.put({
                uri: new URI([rp.domain,'sys','key_value','parsoid.data-parsoid',rp.title,tid]),
                headers: rbUtil.extend({}, parsoidResp.headers, {
                    'content-type': contentTypes['data-parsoid']
                }),
                body: parsoidResp.body['data-parsoid']
            })
        ]);
    }
    // And return the response to the client
    var resp = {
        'status': parsoidResp.status,
        headers: rbUtil.extend({}, parsoidResp.headers),
        body: parsoidResp.body[format]
    };
    // XXX: Fix Parsoid's content-type, so that we don't need to
    // override this here!
    resp.headers['content-type'] = contentTypes[format];
    return resp;
};

PSP.generateAndSave = function(restbase, req, format, tid) {
    var self = this;
    // Try to generate HTML on the fly by calling Parsoid
    var rp = req.params;
    return restbase.get({
        uri: new URI([rp.domain,'sys','parsoid','pagebundle',rp.title,rp.revision])
    }).then(function(parsoidResp) {
        return self.saveParsoidResult(restbase, req, format, tid, parsoidResp);
    });
};

PSP.getRevision = function(restbase, req) {
    var rp = req.params;
    if (/^(?:[0-9]+|latest)$/.test(rp.revision)) {
        // Resolve to a tid
        return restbase.get({
            uri: new URI([rp.domain,'sys','page_revisions','page',rp.title,rp.revision])
        })
        .then(function(res) {
            // FIXME: use tid range!
            return res.body.items[0].tid;
        });
    } else {
        throw new Error("Invalid revision: " + rp.revision);
    }
};

PSP.getFormat = function (format) {
    var self = this;

    return function (restbase, req) {
        var rp = req.params;
        return self.getRevision(restbase, req)
        .then(function(revision) {
            rp.revision = revision + '';
            if (req.headers && /no-cache/.test(req.headers['cache-control'])) {
                var tid = uuid.v1();
                return self.generateAndSave(restbase, req, format, tid);
            } else {
                req.uri = self.getBucketURI(rp, format);
                return restbase.get(req)
                .catch(function(res) {
                    if (res.status === 404 && /^[0-9]+$/.test(rp.revision)) {
                        var tid = (res.headers || {}).etag;
                        return self.generateAndSave(restbase, req, format, tid);
                    } else {
                        // re-throw
                        throw(res);
                    }
                });
            }
        });
    };
};

PSP.transformRevision = function (restbase, req, from, to) {
    var self = this;
    var rp = req.params;

    var fromStorage = {
        revid: rp.revision
    };

    function get(format) {
        return restbase.get({ uri: self.getBucketURI(rp, format) })
        .then(function (res) {
            if (res.body &&
                res.body.headers && res.body.headers['content-type'] &&
                res.body.body) {
                fromStorage[format] = {
                    headers: {
                        'content-type': res.body.headers['content-type']
                    },
                    body: res.body.body
                };
            }
        });
    }

    return Promise.all([ get('html'), get('wikitext'), get('data-parsoid') ])
    .then(function () {
        var body2 = {
            original: fromStorage
        };
        body2[from] = req.body;
        return restbase.post({
            uri: new URI([rp.domain,'sys','parsoid','transform',from,'to',to]),
            headers: { 'content-type': 'application/json' },
            body: body2
        });
    });

};

PSP.makeTransform = function (from, to) {
    var self = this;

    return function (restbase, req) {
        var rp = req.params;
        if (rp.revision) {
            return self.transformRevision(restbase, req, from, to);
        } else {
            // Parsoid currently spells 'wikitext' as 'wt'
            var parsoidTo = (to === 'wikitext') ? 'wt' : to;

            // fake title to avoid Parsoid error: <400/No title or wikitext was provided>
            var parsoidExtra = (from === 'html') ? '/_' : '';

            return restbase.post({
                uri: self.parsoidHost + '/v2/' + rp.domain + '/' + parsoidTo + parsoidExtra,
                headers: { 'content-type': 'application/json' },
                body: req.body
            });
        }
    };
};


module.exports = function (options) {
    var ps = new ParsoidService(options);

    return {
        spec: {
            paths: {
                '/pagebundle/{title}{/revision}': {
                    get: { operationId: 'getPageBundle' }
                },
                '/wikitext/{title}{/revision}': {
                    get: { operationId: 'getWikitext' }
                },
                '/html/{title}{/revision}': {
                    get: { operationId: 'getHtml' }
                },
                '/data-parsoid/{title}{/revision}': {
                    get: { operationId: 'getDataParsoid' }
                },
                '/transform/html/to/html{/title}{/revision}': {
                    post: { operationId: 'transformHtmlToHtml' }
                },
                '/transform/html/to/wikitext{/title}{/revision}': {
                    post: { operationId: 'transformHtmlToWikitext' }
                },
                '/transform/wikitext/to/html{/title}{/revision}': {
                    post: { operationId: 'transformWikitextToHtml' }
                }
            }
        },
        operations: {
            getPageBundle: function(restbase, req) {
                var rp = req.params;
                return ps.pagebundle(restbase, req);
            },
            getWikitext: ps.getFormat('wikitext'),
            getHtml: ps.getFormat('html'),
            getDataParsoid: ps.getFormat('data-parsoid'),
            transformHtmlToHtml: ps.makeTransform('html', 'html'),
            transformHtmlToWikitext: ps.makeTransform('html', 'wikitext'),
            transformWikitextToHtml: ps.makeTransform('wikitext', 'html')
        }
    };
};
