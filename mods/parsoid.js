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


function ParsoidService(options) {
    options = options || {};
    this.parsoidHost = options.parsoidHost
        || 'http://parsoid-lb.eqiad.wikimedia.org';
    // Set up operations
    var self = this;
    this.operations = {
        getPageBundle: function(restbase, req) {
            return self.wrapContentReq(restbase, req,
                    self.pagebundle(restbase, req), 'pagebundle');
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
PSP.wrapContentReq = function(restbase, req, promise, format, tid) {
    var rp = req.params;
    function ensureCharsetInContentType(res) {
        var cType = res.headers['content-type'];
        if (/^text\/html\b/.test(cType) && !/charset=/.test(cType)) {
            // Make sure a charset is set
            res.headers['content-type'] = cType + ';charset=utf-8';
        }
        return res;
    }

    if(!rp.revision && !req.query.sections) {
        // we are dealing with the latest revision,
        // so no need to check it, as the latest
        // revision can never be supressed
        return promise.then(ensureCharsetInContentType);
    }
    var reqs = {
        content: promise,
    };

    if (rp.revision) {
        // Bundle the promise together with a call to getRevisionInfo(). A
        // failure in getRevisionInfo will abort the entire request.
        reqs.revisionInfo = this.getRevisionInfo(restbase, req);
    }

    // If the format is HTML and sections were requested, also request section
    // offsets
    if (format === 'html' && req.query.sections) {
        reqs.sectionOffsets = restbase.get({
            uri: this.getBucketURI(rp, 'section.offsets', tid)
        });
    }

    return P.props(reqs)
    .then(function(responses) {
        // if we have reached this point, it means access is not denied, and
        // sections (if requested) were found
        if (format === 'html' && req.query.sections) {
            // Handle section requests
            var sectionOffsets = responses.sectionOffsets.body;
            var sections = req.query.sections.split(',').map(function(id) {
                return id.trim();
            });
            var body = cheapBodyInnerHTML(responses.content.body.toString());
            var chunks = {};
            sections.forEach(function(id) {
                var offsets = sectionOffsets[id];
                if (!offsets) {
                    throw new rbUtil.HTTPError({
                        status: 400,
                        body: {
                            type: 'invalid_request',
                            detail: 'Unknown section id: ' + id
                        }
                    });
                }
                // offsets as returned by Parsoid are relative to body.innerHTML
                chunks[id] = body.substring(offsets.html[0], offsets.html[1]);
            });

            return {
                status: 200,
                headers: {
                    etag: responses.content.headers.etag,
                    'content-type': 'application/json',
                },
                body: chunks,
            };
        } else {
            return ensureCharsetInContentType(responses.content);
        }
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
    var newReq = Object.assign({}, req);
    if (!newReq.method) { newReq.method = 'get'; }
    newReq.uri = this.parsoidHost + '/v2/' + domain + '/pagebundle/'
        + encodeURIComponent(rbUtil.normalizeTitle(rp.title)) + '/' + rp.revision;
    return restbase.request(newReq);
};

PSP.saveParsoidResult = function (restbase, req, format, tid, parsoidResp) {
    var self = this;
    var rp = req.params;
    // handle the response from Parsoid
    if (parsoidResp.status === 200) {
        return P.all([
            restbase.put({
                uri: self.getBucketURI(rp, 'data-parsoid', tid),
                headers: parsoidResp.body['data-parsoid'].headers,
                body: parsoidResp.body['data-parsoid'].body
            }),
            restbase.put({
                uri: self.getBucketURI(rp, 'section.offsets', tid),
                headers: { 'content-type': 'application/json' },
                body: parsoidResp.body['data-parsoid'].body.sectionOffsets
            }),
        ])
        // Save HTML last, so that any error in metadata storage suppresses
        // HTML.
        .then(function() {
            return restbase.put({
                uri: self.getBucketURI(rp, 'html', tid),
                headers: parsoidResp.body.html.headers,
                body: parsoidResp.body.html.body
            });
        })
        // And return the response to the client
        // but only if the revision is accessible
        .then(function() {
            var resp = {
                'status': parsoidResp.status,
                headers: parsoidResp.body[format].headers,
                body: parsoidResp.body[format].body
            };
            resp.headers.etag = rbUtil.makeETag(rp.revision, tid);
            return self.wrapContentReq(restbase, req, P.resolve(resp), format, tid);
        });
    } else {
        return parsoidResp;
    }
};

// Temporary work-around for Parsoid issue
// https://phabricator.wikimedia.org/T93715
function normalizeHtml(html) {
    return html && html.toString
        && html.toString()
            .replace(/ about="[^"]+"(?=[\/> ])|<meta property="mw:TimeUuid"[^>]+>/g, '');
}
function sameHtml(a, b) {
    return normalizeHtml(a) === normalizeHtml(b);
}

PSP.generateAndSave = function(restbase, req, format, currentContentRes) {
    var self = this;
    // Try to generate HTML on the fly by calling Parsoid
    var rp = req.params;

    var pageBundleUri = new URI([rp.domain,'sys','parsoid','pagebundle',
                     rbUtil.normalizeTitle(rp.title),rp.revision]);

    // Helper for retrieving original content from storage & posting it to
    // the Parsoid pagebundle end point
    function getOrigAndPostToParsoid(revision, contentName, updateMode) {
        return self._getOriginalContent(restbase, req, revision)
        .then(function(res) {
            var body = {
                update: updateMode
            };
            body[contentName] = res;
            return restbase.post({
                uri: pageBundleUri,
                headers: {
                    'content-type': 'application/json'
                },
                body: body
            });
        })
        .catch(function(e) {
            // Fall back to plain GET
            return restbase.get({ uri: pageBundleUri });
        });
    }

    var parentRev = parseInt(req.headers['x-restbase-parentrevision']);
    var updateMode = req.headers['x-restbase-mode'];
    var parsoidReq;
    if (parentRev) {
        // OnEdit job update: pass along the predecessor version
        parsoidReq = getOrigAndPostToParsoid(parentRev + '', 'previous');
    } else if (updateMode) {
        // Template or image updates. Similar to html2wt, pass:
        // - current data-parsoid and html
        // - the edit mode
        parsoidReq = getOrigAndPostToParsoid(rp.revision, 'original', updateMode);
    } else {
        // Plain render
        parsoidReq = restbase.get({ uri: pageBundleUri });
    }

    return parsoidReq
    .then(function(res) {
        var htmlBody = res.body.html.body;
        var tid = uuid.v1();
        // Also make sure we have a meta tag for the tid in our output
        if (!/<meta property="mw:TimeUuid" [^>]+>/.test(htmlBody)) {
            res.body.html.body = htmlBody
                .replace(/(<head [^>]+>)/, '$1<meta property="mw:TimeUuid" '
                    + 'content="' + tid + '"/>');
        }
        if (format === 'html' && currentContentRes
                && sameHtml(res.body.html.body, currentContentRes.body)) {
            // New render is the same as the previous one, no need to store
            // it.
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
                         rbUtil.normalizeTitle(rp.title)];
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
    rp.title = rbUtil.normalizeTitle(rp.title);

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
                        var jobTime = Date.parse(req.headers['if-unmodified-since']);
                        var revInfo = rbUtil.parseETag(res.headers.etag);
                        if (revInfo && uuid.v1time(uuid.parse(revInfo.tid)) >= jobTime) {
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
        return contentReq
        .then(function(res) {
            return self.wrapContentReq(restbase, req, P.resolve(res), format);
        },
        generateContent // No need to wrap generateContent
        );
    }
};

PSP.listRevisions = function (format, restbase, req) {
    var self = this;
    var rp = req.params;
    var revReq = {
        uri: new URI([rp.domain, 'sys', 'key_rev_value', 'parsoid.' + format, rbUtil.normalizeTitle(rp.title), '']),
        body: {
            limit: restbase.rb_config.default_page_size,
        }
    };

    if (req.query.page) {
        revReq.body.next = restbase.decodeToken(req.query.page);
    }

    return restbase.get(revReq)
    .then(function(res) {
        if (res.body.next) {
            res.body._links = {
                next: { "href": "?page="+restbase.encodeToken(res.body.next.allpages.gapcontinue) }
            };
        }
        return res;
    });
};

PSP._getOriginalContent = function(restbase, req, revision, tid) {
    var rp = req.params;

    function get(format) {
        var path = [rp.domain,'sys','parsoid',format,
                     rbUtil.normalizeTitle(rp.title),revision];
        if (tid) {
            path.push(tid);
        }

        return restbase.get({
            uri: new URI(path)
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
    .then(function(res) {
        res.revid = revision;
        return res;
    });

};

PSP.transformRevision = function (restbase, req, from, to) {
    var self = this;
    var rp = req.params;

    var tid;
    if (from === 'html') {
        if (req.headers && req.headers['if-match']
                && rbUtil.parseETag(req.headers['if-match'])) {
            // Prefer the If-Match header
            tid = rbUtil.parseETag(req.headers['if-match']).tid;
        } else if (req.body && req.body.html) {
            // Fall back to an inline meta tag in the HTML
            var tidMatch = /<meta property="mw:TimeUuid" content="([^"]+)"\/?>/
                                .exec(req.body.html);
            tid = tidMatch && tidMatch[1];
        }
    }

    return this._getOriginalContent(restbase, req, rp.revision, tid)
    .then(function (original) {
        // Check if parsoid metadata is present as it's required by parsoid.
        if (!original['data-parsoid'].body
                || original['data-parsoid'].body.constructor !== Object
                || !original['data-parsoid'].body.ids) {
            throw new rbUtil.HTTPError({
                status: 400,
                body: {
                    type: 'invalid_request',
                    description: 'The page/revision has no associated Parsoid data'
                }
            });
        }
        var body2 = {
            original: original
        };
        body2[from] = req.body[from];
        var path = [rp.domain,'sys','parsoid','transform',from,'to',to];
        if (rp.title) {
            path.push(rbUtil.normalizeTitle(rp.title));
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
        parsoidExtras.push(rbUtil.normalizeTitle(rp.title));
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
                    revisionRetentionPolicy: {
                        type: 'latest',
                        count: 1,
                        grace_ttl: 86400
                    },
                    valueType: 'blob',
                    version: 1,
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
                    revisionRetentionPolicy: {
                        type: 'latest',
                        count: 1,
                        grace_ttl: 86400
                    },
                    valueType: 'json',
                    version: 1,
                }
            },
            {
                uri: '/{domain}/sys/key_rev_value/parsoid.section.offsets',
                body: {
                    revisionRetentionPolicy: {
                        type: 'latest',
                        count: 1,
                        grace_ttl: 86400
                    },
                    valueType: 'json',
                    version: 1,
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
