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

function ParsoidService(options) {
    options = options || {};
    this.parsoidHost = options.parsoidHost
        || 'http://parsoid-lb.eqiad.wikimedia.org';
}

// Short alias
var PSP = ParsoidService.prototype;

/**
 * Wraps a request for getting content (the promise) into a
 * Promise.all() call, bundling it with a request for revision
 * info, so that a 403 error gets raised overall if access to
 * the revision should be denied
 *
 * @param restbase RESTBase the Restbase router object
 * @param req Object the user request
 * @param promise Promise the promise object to wrap
 */
PSP.wrapContentReq = function(restbase, req, promise) {
    var rp = req.params;
    if(!rp.revision || rbUtil.isTimeUUID(rp.revision) || /^latest$/.test(rp.revision)) {
        // we are dealing with the latest revision,
        // so no need to check it, as the latest
        // revision can never be supressed
        return promise;
    }
    // bundle the promise together with a call to getRevisionInfo()
    return Promise.all([promise, this.getRevisionInfo(restbase, req)]).then(function(resx) {
        // if we have reached this point,
        // it means access is not denied
        return resx[0];
    });
};

PSP.getBucketURI = function(rp, format, tid) {
    var path = [rp.domain,'sys','key_rev_value','parsoid.' + format,
            rp.title,rp.revision];
    if (tid) {
        path.push(tid);
    }
    return new URI(path);
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
        Promise.all([
            restbase.put({
                uri: this.getBucketURI(rp, 'html', tid),
                headers: parsoidResp.body.html.headers,
                body: parsoidResp.body.html.body
            }),
            restbase.put({
                uri: this.getBucketURI(rp, 'data-parsoid', tid),
                headers: parsoidResp.body['data-parsoid'].headers,
                body: parsoidResp.body['data-parsoid'].body
            })
        ]);
        // And return the response to the client
        // but only if the revision is accessible
        var resp = {
            'status': parsoidResp.status,
            headers: parsoidResp.body[format].headers,
            body: parsoidResp.body[format].body
        };
        resp.headers.etag = tid;
        return this.wrapContentReq(restbase, req, Promise.resolve(resp));
    } else {
        return parsoidResp;
    }
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
        if (req.headers && /no-cache/.test(req.headers['cache-control'])
                && rp.revision)
        {
            return self.generateAndSave(restbase, req, format, uuid.v1());
        } else {
            var beReq = {
                uri: self.getBucketURI(rp, format, rp.tid)
            };
            return self.wrapContentReq(restbase, req, restbase.get(beReq)
            .catch(function(e) {
                return self.getRevisionInfo(restbase, req)
                .then(function(revInfo) {
                    rp.revision = revInfo.rev + '';
                    return self.generateAndSave(restbase, req, format, uuid.v1());
                });
            }));
        }
    };
};

PSP.listRevisions = function (format) {
    var self = this;
    return function (restbase, req) {
        var rp = req.params;
        return restbase.get({
            uri: new URI([rp.domain, 'sys', 'key_rev_value', 'parsoid.' + format, rp.title, ''])
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
                return ps.wrapContentReq(restbase, req, ps.pagebundle(restbase, req));
            },
            listWikitextRevisions: ps.listRevisions('wikitext'),
            getWikitext: ps.getFormat('wikitext'),
            listHtmlRevisions: ps.listRevisions('html'),
            getHtml: ps.getFormat('html'),
            listDataParsoidRevisions: ps.listRevisions('data-parsoid'),
            getDataParsoid: ps.getFormat('data-parsoid'),
            transformHtmlToHtml: ps.makeTransform('html', 'html'),
            transformHtmlToWikitext: ps.makeTransform('html', 'wikitext'),
            transformWikitextToHtml: ps.makeTransform('wikitext', 'html')
        },
        // Dynamic resource dependencies, specific to implementation
        resources: [
            {
                uri: '/{domain}/sys/key_rev_value/parsoid.html',
                body: {
                    valueType: 'blob',
                }
            },
            {
                uri: '/{domain}/sys/key_rev_value/parsoid.wikitext',
                body: {
                    valueType: 'blob',
                }
            },
            {
                uri: '/{domain}/sys/key_rev_value/parsoid.data-parsoid',
                body: {
                    valueType: 'json',
                }
            },
            {
                uri: '/{domain}/sys/key_rev_value/parsoid.data-mw',
                body: {
                    valueType: 'json',
                }
            }
        ],
    };
};
