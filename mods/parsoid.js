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
        var resp = {
            'status': parsoidResp.status,
            headers: parsoidResp.body[format].headers,
            body: parsoidResp.body[format].body
        };
        resp.headers.etag = tid;
        return resp;
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
            return restbase.get(beReq)
            .catch(function(e) {
                return self.getRevisionInfo(restbase, req)
                .then(function(revInfo) {
                    rp.revision = revInfo.rev + '';
                    return self.generateAndSave(restbase, req, format, uuid.v1());
                });
            });
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

    function get(format) {
        return restbase.get({
            uri: new URI([rp.domain,'sys','parsoid',format,rp.title,rp.revision])
        })
        .then(function (res) {
            if (res.body && res.body.constructor === Buffer) {
                res.body = res.body.toString();
            }
            return {
                headers: {
                    'content-type': res.headers['content-type']
                },
                body: res.body
            };
        });
    }

    // Get the revision info just to make sure we have access
    return self.getRevisionInfo(restbase, req)
    .then(function(revInfo) {
        return Promise.props({
            html: get('html'),
            // wikitext: get('wikitext'),
            'data-parsoid': get('data-parsoid')
        });
    })
    .then(function (original) {
        original.revid = rp.revision;
        var body2 = {
            original: original
        };
        body2[from] = req.body[from];
        var path = [rp.domain,'sys','parsoid','transform',from,'to',to];
        if (rp.title) {
            path.push(rp.title);
            if (rp.revision) {
                path.push(rp.revision);
            }
        }
        var newReq = {
            uri: new URI(path),
            params: req.params,
            headers: { 'content-type': 'application/json' },
            body: body2
        };
        return self.callParsoidTransform(restbase, newReq, from, to);
    });

};

PSP.callParsoidTransform = function callParsoidTransform (restbase, req, from, to) {
    var rp = req.params;
    // Parsoid currently spells 'wikitext' as 'wt'
    var parsoidTo = to;
    if (to === 'wikitext') {
        parsoidTo = 'wt';
    } else if (to === 'html') {
        // Retrieve pagebundle whenever we want HTML
        parsoidTo = 'pagebundle';
    }


    var parsoidExtras = [];
    if (rp.title) {
        parsoidExtras.push(rp.title);
    } else {
        // fake title to avoid Parsoid error: <400/No title or wikitext was provided>
        parsoidExtras.push('Main_Page');
    }
    if (rp.revision) {
        parsoidExtras.push(rp.revision);
    }
    var parsoidExtraPath = parsoidExtras.map(encodeURIComponent).join('/');
    if (parsoidExtraPath) { parsoidExtraPath = '/' + parsoidExtraPath; }

    var parsoidReq = {
        uri: this.parsoidHost + '/v2/' + rp.domain + '/'
            + parsoidTo + parsoidExtraPath,
        headers: { 'content-type': 'application/json' },
        body: req.body
    };
    return restbase.post(parsoidReq);
};

PSP.makeTransform = function (from, to) {
    var self = this;

    return function (restbase, req) {
        var rp = req.params;
        if (false && !req.body[from]) {
            throw new rbUtil.HTTPError({
                status: 400,
                body: {
                    type: 'invalid_request',
                    description: 'Missing request parameter: ' + from
                }
            });
        }
        var transform;
        if (rp.revision) {
            transform = self.transformRevision(restbase, req, from, to);
        } else {
            transform = self.callParsoidTransform(restbase, req, from, to);
        }
        return transform
        .then(function(res) {
            // Unwrap to the flat response format
            var innerRes = res.body[to];
            innerRes.status = 200;
            return innerRes;
        });
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
