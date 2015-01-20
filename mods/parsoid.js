'use strict';

/*
 * Simple wrapper for Parsoid
 */

var URI = require('swagger-router').URI;
var uuid   = require('node-uuid');
var rbUtil = require('../lib/rbUtil');

// TODO: move tests & spec to separate npm module!
var yaml = require('js-yaml');
var fs = require('fs');
var spec = yaml.safeLoad(fs.readFileSync(__dirname + '/parsoid.yaml'));

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

PSP.getBucketURI = function(rp, format, tid) {
    return new URI([rp.domain,'sys','key_value','parsoid.' + format,rp.title,tid]);
};

PSP.pagebundle = function(restbase, req) {
    var rp = req.params;
    var uri = this.parsoidHost + '/v2/' + rp.domain + '/pagebundle/'
        + encodeURIComponent(rp.title) + '/' + rp.revision;
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
                body: parsoidResp.body.html.body
            }),
            restbase.put({
                uri: new URI([rp.domain,'sys','key_value','parsoid.data-parsoid',rp.title,tid]),
                headers: rbUtil.extend({}, parsoidResp.headers, {
                    'content-type': contentTypes['data-parsoid']
                }),
                body: parsoidResp.body['data-parsoid'].body
            })
        ]);
    }
    // And return the response to the client
    var resp = {
        'status': parsoidResp.status,
        headers: rbUtil.extend({}, parsoidResp.headers),
        body: parsoidResp.body[format].body
    };
    // XXX: Fix Parsoid's content-type, so that we don't need to
    // override this here!
    resp.headers['content-type'] = parsoidResp.body[format].headers['content-type']
        || contentTypes[format];
    return resp;
};

PSP.generateAndSave = function(restbase, req, format, tid) {
    var self = this;
    if (!tid) {
        throw new Error('no tid');
    }
    // Try to generate HTML on the fly by calling Parsoid
    var rp = req.params;
    return restbase.get({
        uri: new URI([rp.domain,'sys','parsoid','pagebundle',rp.title,rp.revision])
    })
    .then(function(parsoidResp) {
        return self.saveParsoidResult(restbase, req, format, tid, parsoidResp);
    });
};

// Get an object with rev and tid properties for the revision
PSP.getRevisionInfo = function(restbase, req) {
    var rp = req.params;
    if (/^(?:[0-9]+|latest)$/.test(rp.revision)) {
        // Resolve to a tid
        return restbase.get({
            uri: new URI([rp.domain,'sys','page_revisions','page',rp.title,rp.revision])
        })
        .then(function(res) {
            // FIXME: use tid range!
            var revInfo = res.body.items[0];
            return revInfo;
        });
    } else if (rbUtil.isTimeUUID(rp.revision)) {
        return Promise.resolve({
            tid: rp.revision,
            rev: null
        });
    } else {
        throw new Error("Invalid revision: " + rp.revision);
    }
};

PSP.getFormat = function (format) {
    var self = this;

    return function (restbase, req) {
        var rp = req.params;
        return self.getRevisionInfo(restbase, req)
        .then(function(revInfo) {
            rp.revision = revInfo.rev + '';
            var tid = revInfo.tid;
            if (req.headers && /no-cache/.test(req.headers['cache-control'])
                    && rp.revision)
            {
                // FIXME: Only allow this for the latest revision!
                tid = uuid.v1();
                return self.generateAndSave(restbase, req, format, tid);
            } else {
                req.uri = self.getBucketURI(rp, format, tid);
                return restbase.get(req)
                .catch(function(res) {
                    if (res.status === 404 && /^[0-9]+$/.test(rp.revision)) {
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
        return self.getRevisionInfo(restbase, req)
        .then(function(revInfo) {
            return restbase.get({ uri: self.getBucketURI(rp, format, revInfo.tid) });
        })
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
        spec: spec,
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
        },
        // Dynamic resource dependencies, specific to implementation
        resources: [
            {
                uri: '/{domain}/sys/key_value/parsoid.html',
                body: {
                    valueType: 'blob',
                }
            },
            {
                uri: '/{domain}/sys/key_value/parsoid.wikitext',
                body: {
                    valueType: 'blob',
                }
            },
            {
                uri: '/{domain}/sys/key_value/parsoid.data-parsoid',
                body: {
                    valueType: 'json',
                }
            },
            {
                uri: '/{domain}/sys/key_value/parsoid.data-mw',
                body: {
                    valueType: 'json',
                }
            }
        ],
    };
};
