'use strict';

/*
 * Simple wrapper for Parsoid
 */

var P = require('bluebird');
var URI = require('swagger-router').URI;
var uuid   = require('node-uuid');
var rbUtil = require('../lib/rbUtil');

// TODO: move tests & spec to separate npm module!
var yaml = require('js-yaml');
var fs = require('fs');
var spec = yaml.safeLoad(fs.readFileSync(__dirname + '/parsoid.yaml'));


// Store titles as MediaWiki db keys
function normalizeTitle (title) {
    return title.replace(/ /g, '_');
}

function ParsoidService(options) {
    options = options || {};
    this.parsoidHost = options.parsoidHost
        || 'http://parsoid-lb.eqiad.wikimedia.org';
    // Set up operations
    var self = this;
    this.operations = {
        getPageBundle: function(restbase, req) {
            return self.wrapContentReq(restbase, req, self.pagebundle(restbase, req));
        },
        // revision retrieval per format
        getWikitext: self.getFormat.bind(self, 'wikitext'),
        getHtml: self.getFormat.bind(self, 'html'),
        getDataParsoid: self.getFormat.bind(self, 'data-parsoid'),
        // listings
        listWikitextRevisions: self.listRevisions.bind(self, 'wikitext'),
        listHtmlRevisions: self.listRevisions.bind(self, 'html'),
        listDataParsoidRevisions: self.listRevisions.bind(self, 'data-parsoid'),
        // transforms
        transformHtmlToHtml: self.makeTransform('html', 'html'),
        transformHtmlToWikitext: self.makeTransform('html', 'wikitext'),
        transformWikitextToHtml: self.makeTransform('wikitext', 'html'),
    };
}

// Short alias
var PSP = ParsoidService.prototype;

/**
 * Wraps a request for getting content (the promise) into a
 * P.all() call, bundling it with a request for revision
 * info, so that a 403 error gets raised overall if access to
 * the revision should be denied
 *
 * @param restbase RESTBase the Restbase router object
 * @param req Object the user request
 * @param promise Promise the promise object to wrap
 */
PSP.wrapContentReq = function(restbase, req, promise) {
    var rp = req.params;
    function ensureCharsetInContentType(res) {
        var cType = res.headers['content-type'];
        if (/^text\/html\b/.test(cType) && !/charset=/.test(cType)) {
            // Make sure a charset is set
            res.headers['content-type'] = cType + ';charset=utf-8';
        }
        return res;
    }

    if(!rp.revision || rbUtil.isTimeUUID(rp.revision) || /^latest$/.test(rp.revision)) {
        // we are dealing with the latest revision,
        // so no need to check it, as the latest
        // revision can never be supressed
        return promise.then(ensureCharsetInContentType);
    }
    // bundle the promise together with a call to getRevisionInfo()
    return P.all([promise, this.getRevisionInfo(restbase, req)]).then(function(resx) {
        // if we have reached this point,
        // it means access is not denied
        return ensureCharsetInContentType(resx[0]);
    });
};

PSP.getBucketURI = function(rp, format, tid) {
    var path = [rp.domain,'sys','key_rev_value','parsoid.' + format, rp.title];
    if (rp.revision) {
        path.push(rp.revision);
        if (tid) {
            path.push(tid);
        }
    }
    return new URI(path);
};

PSP.pagebundle = function(restbase, req) {
    var rp = req.params;
    var domain = rp.domain;
    if (domain === 'en.wikipedia.test.local') { domain = 'en.wikipedia.org'; }
    // TODO: Pass in current or predecessor version data if available
    var uri = this.parsoidHost + '/v2/' + domain + '/pagebundle/'
        + encodeURIComponent(normalizeTitle(rp.title)) + '/' + rp.revision;
    return restbase.get({ uri: uri });
};

PSP.saveParsoidResult = function (restbase, req, format, tid, parsoidResp) {
    var rp = req.params;
    // handle the response from Parsoid
    if (parsoidResp.status === 200) {
        P.all([
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
        return this.wrapContentReq(restbase, req, P.resolve(resp));
    } else {
        return parsoidResp;
    }
};

// Temporary work-around for Parsoid issue
// https://phabricator.wikimedia.org/T93715
function normalizeHtml(html) {
    return html && html.toString
        && html.toString().replace(/ about="[^"]+"(?=[\/> ])/g, '');
}
function sameHtml(a, b) {
    return normalizeHtml(a) === normalizeHtml(b);
}

PSP.generateAndSave = function(restbase, req, format, currentContentRes) {
    var self = this;
    var tid = uuid.v1();
    // Try to generate HTML on the fly by calling Parsoid
    var rp = req.params;
    var storageRequest = null;

    return restbase.get({
        uri: new URI([rp.domain,'sys','parsoid','pagebundle',
                     normalizeTitle(rp.title),rp.revision])
    })
    .then(function(res) {
        if (format === 'html' && currentContentRes
                && sameHtml(res.body.html.body, currentContentRes.body)) {
            // New render is the same as the previous one, no need to store
            // it.
            //console.log('not saving a new revision!');
            restbase.metrics.increment('sys_parsoid_generateAndSave.unchanged_rev_render');

            // No need for wrapping here, as we rely on the pagebundle request
            // being wrapped & throwing an error if access is denied
            return currentContentRes;
        } else {
            return self.saveParsoidResult(restbase, req, format, tid, res);
        }
    });
};

// Get / check the revision metadata for a request
PSP.getRevisionInfo = function(restbase, req) {
    var rp = req.params;
    var path = [rp.domain,'sys','page_revisions','page',
                         normalizeTitle(rp.title)];
    if (/^(?:[0-9]+)$/.test(rp.revision)) {
        path.push(rp.revision);
    } else if (rp.revision) {
        throw new Error("Invalid revision: " + rp.revision);
    }

    return restbase.get({
        uri: new URI(path)
    })
    .then(function(res) {
        return res.body.items[0];
    });
};

PSP.getFormat = function (format, restbase, req) {
    var self = this;
    var rp = req.params;
    rp.title = normalizeTitle(rp.title);

    function generateContent (storageRes) {
        if (storageRes.status === 404 || storageRes.status === 200) {
            return self.getRevisionInfo(restbase, req)
            .then(function(revInfo) {
                rp.revision = revInfo.rev + '';
                if (revInfo.title !== rp.title) {
                    // Re-try to retrieve from storage with the
                    // normalized title & revision
                    rp.title = revInfo.title;
                    return self.getFormat(format, restbase, req);
                } else {
                    return self.generateAndSave(restbase, req, format, storageRes);
                }
            });
        } else {
            // Don't generate content if there's some other error.
            throw storageRes;
        }
    }

    var contentReq = restbase.get({
        uri: self.getBucketURI(rp, format, rp.tid)
    });

    if (req.headers && /no-cache/i.test(req.headers['cache-control'])
            && rp.revision)
    {
        // Check content generation either way
        return contentReq.then(function(res) {
                if (req.headers['if-unmodified-since']) {
                    try {
                        var jobTime = new Date(req.headers['if-unmodified-since']);
                        if (uuid.v1time(res.headers.etag) >= jobTime) {
                            // Already up to date, nothing to do.
                            return {
                                status: 412,
                                body: {
                                    type: 'precondition_failed',
                                    detail: 'The precondition failed'
                                }
                            };
                        }
                    } catch (e) {} // Ignore errors from date parsing
                }
                return generateContent(res);
            },
            generateContent);
    } else {
        // Only (possibly) generate content if there was an error
        return self.wrapContentReq(restbase, req,
                contentReq.catch(generateContent));
    }
};

PSP.listRevisions = function (format, restbase, req) {
    var self = this;
    var rp = req.params;
    return restbase.get({
        uri: new URI([rp.domain, 'sys', 'key_rev_value', 'parsoid.' + format,
                     normalizeTitle(rp.title), ''])
    });
};

PSP.transformRevision = function (restbase, req, from, to) {
    var self = this;
    var rp = req.params;

    function get(format) {
        return restbase.get({
            uri: new URI([rp.domain,'sys','parsoid',format,
                         normalizeTitle(rp.title),rp.revision])
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

    return P.props({
        html: get('html'),
        // wikitext: get('wikitext'),
        'data-parsoid': get('data-parsoid')
    })
    .then(function (original) {
        original.revid = rp.revision;
        var body2 = {
            original: original
        };
        body2[from] = req.body[from];
        var path = [rp.domain,'sys','parsoid','transform',from,'to',to];
        if (rp.title) {
            path.push(normalizeTitle(rp.title));
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
        parsoidExtras.push(normalizeTitle(rp.title));
    } else {
        // fake title to avoid Parsoid error: <400/No title or wikitext was provided>
        parsoidExtras.push('Main_Page');
    }
    if (rp.revision) {
        parsoidExtras.push(rp.revision);
    }
    var parsoidExtraPath = parsoidExtras.map(encodeURIComponent).join('/');
    if (parsoidExtraPath) { parsoidExtraPath = '/' + parsoidExtraPath; }

    var domain = rp.domain;
    // Re-map test domain
    if (domain === 'en.wikipedia.test.local') { domain = 'en.wikipedia.org'; }
    var parsoidReq = {
        uri: this.parsoidHost + '/v2/' + domain + '/'
            + parsoidTo + parsoidExtraPath,
        headers: { 'content-type': 'application/json' },
        body: req.body
    };
    return restbase.post(parsoidReq);
};

/**
 * Cheap body.innerHTML extraction.
 *
 * This is safe as we know that the HTML we are receiving from Parsoid is
 * serialized as XML.
 */
function cheapBodyInnerHTML(html) {
    var match = /<body[^>]*>([\s\S]*)<\/body>/.exec(html);
    if (!match) {
        throw new Error('No HTML body found!');
    } else {
        return match[1];
    }
}

PSP.makeTransform = function (from, to) {
    var self = this;

    return function (restbase, req) {
        var rp = req.params;
        if (!req.body[from]) {
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
            // Handle bodyOnly flag
            if (to === 'html' && req.body.bodyOnly) {
                innerRes.body = cheapBodyInnerHTML(innerRes.body);
            }
            return innerRes;
        });
    };
};


module.exports = function (options) {
    var ps = new ParsoidService(options);

    return {
        spec: spec,
        operations: ps.operations,
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
