'use strict';

/*
 * Simple wrapper for Parsoid
 */

var P = require('bluebird');
var HyperSwitch = require('hyperswitch');
var Title = require('mediawiki-title').Title;
var URI = HyperSwitch.URI;
var HTTPError = HyperSwitch.HTTPError;

var uuid   = require('cassandra-uuid').TimeUuid;
var mwUtil = require('../lib/mwUtil');

var spec = HyperSwitch.utils.loadSpec(__dirname + '/parsoid.yaml');

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

/**
 * Makes sure we have a meta tag for the tid in our output
 *
 * @param html {string} original HTML content
 * @param tid {string} the tid to insert
 * @returns {string} modified html
 */
function insertTidMeta(html, tid) {
    if (!/<meta property="mw:TimeUuid" [^>]+>/.test(html)) {
        return html.replace(/(<head [^>]+>)/,
            '$1<meta property="mw:TimeUuid" content="' + tid + '"/>');
    }
    return html;
}

function extractTidMeta(html) {
    // Fall back to an inline meta tag in the HTML
    var tidMatch = new RegExp('<meta\\s+(?:content="([^"]+)"\\s+)?' +
            'property="mw:TimeUuid"(?:\\s+content="([^"]+)")?\\s*\\/?>')
    .exec(html);
    return tidMatch && (tidMatch[1] || tidMatch[2]);
}

/**
 *  Checks whether the content has been modified since the timestamp
 *  in `if-unmodified-since` header of the request
 *
 * @param req {object} the request
 * @param res {object} the response
 * @returns {boolean} true if content has beed modified
 */
function isModifiedSince(req, res) {
    try {
        if (req.headers['if-unmodified-since']) {
            var jobTime = Date.parse(req.headers['if-unmodified-since']);
            var revInfo = mwUtil.parseETag(res.headers.etag);
            return revInfo && uuid.fromString(revInfo.tid).getDate() >= jobTime;
        }
    } catch (e) {
        // Ignore errors from date parsing
    }
    return false;
}

function ParsoidService(options) {
    var self = this;
    this.options = options = options || {};
    this.parsoidHost = options.parsoidHost;

    // Set up operations
    this.operations = {
        getPageBundle: self.pagebundle.bind(self),
        // Revision retrieval per format
        getWikitext: self.getFormat.bind(self, 'wikitext'),
        getHtml: self.getFormat.bind(self, 'html'),
        getDataParsoid: self.getFormat.bind(self, 'data-parsoid'),
        // Listings
        listWikitextRevisions: self.listRevisions.bind(self, 'wikitext'),
        listHtmlRevisions: self.listRevisions.bind(self, 'html'),
        listDataParsoidRevisions: self.listRevisions.bind(self, 'data-parsoid'),
        // Transforms
        transformHtmlToHtml: self.makeTransform('html', 'html'),
        transformHtmlToWikitext: self.makeTransform('html', 'wikitext'),
        transformWikitextToHtml: self.makeTransform('wikitext', 'html'),
        transformSectionsToWikitext: self.makeTransform('sections', 'wikitext')
    };
}

// Short alias
var PSP = ParsoidService.prototype;

// TEMP TEMP TEMP!!!
// Wiktionary / summary invalidation and mobileapps pregeneration
PSP._dependenciesUpdate = function(hyper, req) {
    var rp = req.params;
    return mwUtil.getSiteInfo(hyper, req)
    .then(function(siteInfo) {
        var rp = req.params;
        var updates = [];
        var summaryPromise = P.resolve();
        if (rp.domain.indexOf('wiktionary') === -1) {
            // non-wiktionary, update summary
            summaryPromise = hyper.get({
                uri: new URI([rp.domain, 'v1', 'page', 'summary', rp.title]),
                headers: {
                    'cache-control': 'no-cache'
                }
            });
        } else if (/en.wiktionary/.test(rp.domain)) {
            if (Title.newFromText(rp.title, siteInfo).getNamespace().isMain()) {
                // wiktionary update, we are interested only in en.wiktionary
                // and only in Main namespaces
                summaryPromise = hyper.get({
                    uri: new URI([rp.domain, 'v1', 'page', 'definition', rp.title]),
                    headers: {
                        'cache-control': 'no-cache'
                    }
                });
            }
        }
        summaryPromise = summaryPromise.catch(function(e) {
            if (e.status !== 501 && e.status !== 404) {
                hyper.log('error/' + rp.domain.indexOf('wiktionary') < 0 ?
                        'summary' : 'definition', e);
            }
        });
        updates.push(summaryPromise);

        // Emit resource change events
        var publicBaseURI = '//' + rp.domain + '/api/rest_v1/page';
        updates.push(hyper.post({
            uri: new URI([rp.domain, 'sys', 'events', '']),
            body: [
                { meta: { uri: publicBaseURI + '/html/' + encodeURIComponent(rp.title) } },
                { meta: { uri: publicBaseURI + '/html/' + encodeURIComponent(rp.title)
                    + '/' + rp.revision } }
            ]
        }));

        updates.push(hyper.get({
            uri: new URI([rp.domain, 'sys', 'mobileapps', 'mobile-sections', rp.title]),
            headers: {
                'cache-control': 'no-cache'
            }
        }));

        return P.all(updates);
    })
    .catch(function(e) {
        hyper.log('warn/mobileapps', e);
    });
};

PSP.getBucketURI = function(rp, format, tid, useKeyRevValue) {
    var bucket = useKeyRevValue ? 'key_rev_value' : this.options.bucket_type;
    var path = [rp.domain, 'sys', bucket, 'parsoid.' + format, rp.title];
    if (rp.revision) {
        path.push(rp.revision);
        if (tid) {
            path.push(tid);
        }
    }
    return new URI(path);
};

PSP.pagebundle = function(hyper, req) {
    var rp = req.params;
    var domain = rp.domain;
    var newReq = Object.assign({}, req);
    if (!newReq.method) { newReq.method = 'get'; }
    var path = (newReq.method === 'get') ? 'page' : 'transform/wikitext/to';
    newReq.uri = this.parsoidHost + '/' + domain + '/v3/' + path + '/pagebundle/'
        + encodeURIComponent(rp.title) + '/' + rp.revision;
    return hyper.request(newReq);
};

PSP.saveParsoidResult = function(hyper, req, format, tid, parsoidResp) {
    var self = this;
    var rp = req.params;
    return P.join(
        hyper.put({
            uri: self.getBucketURI(rp, 'data-parsoid', tid),
            headers: parsoidResp.body['data-parsoid'].headers,
            body: parsoidResp.body['data-parsoid'].body
        }),
        hyper.put({
            uri: self.getBucketURI(rp, 'section.offsets', tid),
            headers: { 'content-type': 'application/json' },
            body: parsoidResp.body['data-parsoid'].body.sectionOffsets
        })
    )
    // Save HTML last, so that any error in metadata storage suppresses HTML.
    .then(function() {
        return hyper.put({
            uri: self.getBucketURI(rp, 'html', tid),
            headers: parsoidResp.body.html.headers,
            body: parsoidResp.body.html.body
        });
    });
};

PSP.generateAndSave = function(hyper, req, format, currentContentRes) {
    var self = this;
    // Try to generate HTML on the fly by calling Parsoid
    var rp = req.params;
    var reqRevision = rp.revision;

    // Helper for retrieving original content from storage & posting it to
    // the Parsoid pagebundle end point
    function getOrigAndPostToParsoid(pageBundleUri, revision, contentName, updateMode) {
        return self._getOriginalContent(hyper, req, revision)
        .then(function(res) {
            var body = {
                update: updateMode
            };
            body[contentName] = res;
            return hyper.post({
                uri: pageBundleUri,
                headers: {
                    'content-type': 'application/json',
                    'user-agent': req.headers['user-agent'],
                },
                body: body
            });
        }, function(e) {
            // Fall back to plain GET
            return hyper.get({ uri: pageBundleUri });
        });
    }

    return self.getRevisionInfo(hyper, req)
    .then(function(revInfo) {
        rp.revision = revInfo.rev + '';
        if (reqRevision !== rp.revision) {
            // Try to fetch the HTML corresponding to the requested revision,
            // so that the change detection makes sense.
            return hyper.get({
                uri: self.getBucketURI(rp, format, rp.tid)
            }).then(
                function(contentRes) {
                    currentContentRes = contentRes;
                },
                function(contentRes) {
                    currentContentRes = contentRes;
                }
            );
        }
    })
    .then(function(revInfo) {
        var pageBundleUri = new URI([rp.domain, 'sys', 'parsoid', 'pagebundle',
                rp.title, rp.revision]);

        var parentRev = parseInt(req.headers['x-restbase-parentrevision']);
        var updateMode = req.headers['x-restbase-mode'];
        var parsoidReq;
        if (parentRev) {
            // OnEdit job update: pass along the predecessor version
            parsoidReq = getOrigAndPostToParsoid(pageBundleUri, parentRev + '', 'previous');
        } else if (updateMode) {
            // Template or image updates. Similar to html2wt, pass:
            // - current data-parsoid and html
            // - the edit mode
            parsoidReq = getOrigAndPostToParsoid(pageBundleUri, rp.revision,
                    'original', updateMode);
        } else {
            // Plain render
            parsoidReq = hyper.get({ uri: pageBundleUri });
        }

        return P.join(parsoidReq, mwUtil.decodeBody(currentContentRes))
        .spread(function(res, currentContentRes) {
            var tid = uuid.now().toString();
            res.body.html.body = insertTidMeta(res.body.html.body, tid);

            if (format === 'html'
                    && currentContentRes
                    && currentContentRes.status === 200
                    && sameHtml(res.body.html.body, currentContentRes.body)) {
                // New render is the same as the previous one, no need to store it.
                hyper.metrics.increment('sys_parsoid_generateAndSave.unchanged_rev_render');
                return currentContentRes;
            } else if (res.status === 200) {
                var resp = {
                    status: res.status,
                    headers: res.body[format].headers,
                    body: res.body[format].body
                };
                resp.headers.etag = mwUtil.makeETag(rp.revision, tid);
                return self.saveParsoidResult(hyper, req, format, tid, res)
                .then(function() {
                    var dependencyUpdate = self._dependenciesUpdate(hyper, req);
                    if (mwUtil.isNoCacheRequest(req)) {
                        // Finish background updates before returning
                        return dependencyUpdate.thenReturn(resp);
                    } else {
                        return resp;
                    }
                });
            } else {
                return res;
            }
        });
    });
};

PSP.getSections = function(hyper, req) {
    var self = this;
    var rp = req.params;

    var sections = req.query.sections.split(',').map(function(id) {
        return id.trim();
    });
    delete req.query.sections;

    return self.getFormat('html', hyper, req)
    .then(function(htmlRes) {
        var etagInfo = htmlRes.headers.etag;
        var sectionsRP = Object.assign({}, rp, {
            revision: etagInfo.rev,
            tid: etagInfo.tid
        });
        return hyper.get({
            uri: self.getBucketURI(sectionsRP, 'section.offsets', sectionsRP.tid)
        })
        .then(function(sectionOffsets) {
            return mwUtil.decodeBody(htmlRes).then(function(content) {
                var body = cheapBodyInnerHTML(content.body);
                var chunks = sections.reduce(function(result, id) {
                    var offsets = sectionOffsets.body[id];
                    if (!offsets) {
                        throw new HTTPError({
                            status: 400,
                            body: {
                                type: 'bad_request',
                                detail: 'Unknown section id: ' + id
                            }
                        });
                    }
                    // Offsets as returned by Parsoid are relative to body.innerHTML
                    result[id] = body.substring(offsets.html[0], offsets.html[1]);
                    return result;
                }, {});
                return {
                    status: 200,
                    headers: {
                        etag: htmlRes.headers.etag,
                        'cache-control': 'no-cache',
                        'content-type': 'application/json'
                    },
                    body: chunks
                };
            });
        });
    });
};

// Get / check the revision metadata for a request
PSP.getRevisionInfo = function(hyper, req) {
    var rp = req.params;
    var path = [rp.domain, 'sys', 'page_revisions', 'page', rp.title];
    if (/^(?:[0-9]+)$/.test(rp.revision)) {
        path.push(rp.revision);
    } else if (rp.revision) {
        throw new Error("Invalid revision: " + rp.revision);
    }

    return hyper.get({
        uri: new URI(path),
        headers: {
            'cache-control': req.headers && req.headers['cache-control']
        }
    })
    .then(function(res) {
        return res.body.items[0];
    });
};

/**
 * Internal check to see if it's okay to re-render a particular title in
 * response to a no-cache request.
 *
 * TODO: Remove this temporary code once
 * https://phabricator.wikimedia.org/T120171 and
 * https://phabricator.wikimedia.org/T120972 are resolved / resource
 * consumption for these articles has been reduced to a reasonable level.
 *
 * @param {Request} req the request being processed
 * @return {boolean} Whether re-rendering this title is okay.
 */
PSP._okayToRerender = function(req) {
    if (mwUtil.isNoCacheRequest(req)) {
        var blackList = this.options.rerenderBlacklist;
        if (blackList) {
            return !blackList[req.params.domain]
                || !blackList[req.params.domain][req.params.title];
        }
    }
    return true;
};

PSP.getFormat = function(format, hyper, req) {
    var self = this;
    var rp = req.params;


    if (format === 'html' && req.query.sections) {
        return self.getSections(hyper, req);
    }

    function generateContent(storageRes) {
        if (storageRes.status === 404 || storageRes.status === 200) {
            return self.generateAndSave(hyper, req, format, storageRes);
        } else {
            // Don't generate content if there's some other error.
            throw storageRes;
        }
    }

    if (!self._okayToRerender(req)) {
        // Still update the revision metadata.
        return self.getRevisionInfo(hyper, req)
        .then(function() {
            throw new HTTPError({
                status: 403,
                body: {
                    type: 'bad_request#rerenders_disabled',
                    description: "Rerenders for this article are blacklisted in the config."
                }
            });
        });
    }

    var contentReq = hyper.get({
        uri: self.getBucketURI(rp, format, rp.tid)
    });

    if (mwUtil.isNoCacheRequest(req)) {
        // Check content generation either way
        contentReq = contentReq.then(function(res) {
                if (isModifiedSince(req, res)) {
                    // Already up to date, nothing to do.
                    return {
                        status: 412,
                        body: {
                            type: 'precondition_failed',
                            detail: 'The precondition failed'
                        }
                    };
                }
                return generateContent(res);
            },
            generateContent);
    } else {
        // Only (possibly) generate content if there was an error
        contentReq = contentReq.catch(generateContent);
    }
    return contentReq
    .then(function(res) {
        mwUtil.normalizeContentType(res);
        HyperSwitch.misc.addCSPHeaders(res, {
            domain: rp.domain,
            allowInline: true,
        });
        if (self.options.response_cache_control) {
            res.headers['cache-control'] = self.options.response_cache_control;
        }
        if (/^null$/.test(res.headers.etag)) {
            hyper.log('error/parsoid/response_etag_missing', {
                msg: 'Detected a null etag in the response!'
            });
        }

        return res;
    });
};

PSP.listRevisions = function(format, hyper, req) {
    var self = this;
    var rp = req.params;
    var revReq = {
        uri: new URI([rp.domain, 'sys', this.options.bucket_type,
                'parsoid.' + format, rp.title, '']),
        body: {
            limit: hyper.config.default_page_size
        }
    };

    if (req.query.page) {
        revReq.body.next = mwUtil.decodePagingToken(hyper, req.query.page);
    }

    return hyper.get(revReq)
    .then(function(res) {
        if (res.body.next) {
            res.body._links = {
                next: {
                    href: "?page=" + mwUtil.encodePagingToken(hyper, res.body.next)
                }
            };
        }
        return res;
    });
};

PSP._getOriginalContent = function(hyper, req, revision, tid) {
    var rp = req.params;

    function get(format) {
        var path = [rp.domain, 'sys', 'parsoid', format, rp.title, revision];
        if (tid) {
            path.push(tid);
        }

        return hyper.get({ uri: new URI(path) }).then(mwUtil.decodeBody);
    }

    return P.props({
        html: get('html'),
        'data-parsoid': get('data-parsoid')
    })
    .then(function(res) {
        res.revid = revision;
        return res;
    });

};

PSP._getStashedContent = function(hyper, req, etag) {
    var self = this;
    var rp = req.params;
    function getStash(format) {
        return hyper.get({
            uri: self.getBucketURI(rp, 'stash.' + format, etag.tid, true)
        })
        .then(mwUtil.decodeBody);
    }

    return P.props({
        html: getStash('html'),
        'data-parsoid': getStash('data-parsoid'),
        wikitext: getStash('wikitext')
    })
    .then(function(res) {
        res.revid = rp.revision;
        return res;
    });

};

/**
 * Replaces sections in original content with sections provided in sectionsJson
 */
function replaceSections(original, sectionsJson) {
    var sectionOffsets = original['data-parsoid'].body.sectionOffsets;
    var newBody = cheapBodyInnerHTML(original.html.body);
    var sectionIds = Object.keys(sectionsJson);
    var illegalId = sectionIds.some(function(id) {
        return !sectionOffsets[id];
    });
    if (illegalId) {
        throw new HTTPError({
            status: 400,
            body: {
                type: 'bad_request',
                description: 'Invalid section ids'
            }
        });
    }
    sectionIds.sort(function(id1, id2) {
        return sectionOffsets[id2].html[0] - sectionOffsets[id1].html[0];
    })
    .forEach(function(id) {
        var offset = sectionOffsets[id];
        newBody = newBody.substring(0, offset.html[0])
        + sectionsJson[id]
        + newBody.substring(offset.html[1], newBody.length);
    });
    return '<body>' + newBody + '</body>';
}

function parseSections(req) {
    var sections = req.body.sections;
    if (sections.constructor !== Object) {
        try {
            return JSON.parse(req.body.sections.toString());
        } catch (e) {
            // Catch JSON parsing exception and return 400
            throw new HTTPError({
                status: 400,
                body: {
                    type: 'bad_request',
                    description: 'Invalid JSON provided in the request'
                }
            });
        }
    }
    return sections;
}


PSP.transformRevision = function(hyper, req, from, to) {
    var self = this;
    var rp = req.params;

    var etag = req.headers && mwUtil.parseETag(req.headers['if-match']);
    var tid;
    if (from === 'html') {
        if (etag) {
            // Prefer the If-Match header
            tid = etag.tid;
        }

        if (req.body && req.body.html) {
            // Fall back to an inline meta tag in the HTML
            var htmlTid = extractTidMeta(req.body.html);
            if (tid && htmlTid && htmlTid !== tid) {
                hyper.log('error/parsoid/etag_mismatch', {
                    msg: 'Client-supplied etag did not match mw:TimeUuid!'
                });
            } else if (!tid) {
                tid = htmlTid;
                hyper.log('warn/parsoid/etag', {
                    msg: 'Client did not supply etag, fallback to mw:TimeUuid meta element'
                });
            }
        }
        if (!tid) {
            throw new HTTPError({
                status: 400,
                body: {
                    type: 'bad_request',
                    description: 'No or invalid If-Match header supplied, '
                        + 'or missing mw:TimeUuid meta element in the supplied HTML.',
                }
            });
        }
    }

    var contentPromise;
    if (etag && etag.suffix === 'stash' && from === 'html' && to === 'wikitext') {
        contentPromise = this._getStashedContent(hyper, req, etag);
    } else {
        contentPromise = this._getOriginalContent(hyper, req, rp.revision, tid);
    }
    return contentPromise.then(function(original) {
        // Check if parsoid metadata is present as it's required by parsoid.
        if (!original['data-parsoid'].body
                || original['data-parsoid'].body.constructor !== Object
                || !original['data-parsoid'].body.ids) {
            throw new HTTPError({
                status: 400,
                body: {
                    type: 'bad_request',
                    description: 'The page/revision has no associated Parsoid data'
                }
            });
        }
        var body2 = {
            original: original
        };
        if (from === 'sections') {
            body2.html = {
                body: replaceSections(original, parseSections(req))
            };
            from = 'html';
        } else {
            body2[from] = req.body[from];
        }

        body2.scrub_wikitext = req.body.scrub_wikitext;
        body2.body_only = req.body.body_only;

        // Let the stash flag through as well
        if (req.body.stash) {
            body2.stash = true;
        }

        var path = [rp.domain, 'sys', 'parsoid', 'transform', from, 'to', to];
        if (rp.title) {
            path.push(rp.title);
            if (rp.revision) {
                path.push(rp.revision);
            }
        }
        var newReq = {
            uri: new URI(path),
            params: req.params,
            headers: {
                'content-type': 'application/json',
                'user-agent': req['user-agent'],
            },
            body: body2
        };
        return self.callParsoidTransform(hyper, newReq, from, to);
    });

};

PSP.stashTransform = function(hyper, req, transformPromise) {
    // A stash has been requested. We need to store the wikitext sent by
    // the client together with the page bundle returned by Parsoid, so it
    // can be later reused when transforming back from HTML to wikitext
    // cf https://phabricator.wikimedia.org/T114548
    var self = this;
    var rp = req.params;
    var tid = uuid.now().toString();
    var wtType = req.original && req.original.headers['content-type'] || 'text/plain';
    return transformPromise.then(function(original) {
        // Save the returned data-parsoid for the transform and
        // the wikitext sent by the client
        return P.all([
            hyper.put({
                uri: self.getBucketURI(rp, 'stash.data-parsoid', tid, true),
                headers: original.body['data-parsoid'].headers,
                body: original.body['data-parsoid'].body
            }),
            hyper.put({
                uri: self.getBucketURI(rp, 'stash.wikitext', tid, true),
                headers: { 'content-type': wtType },
                body: req.body.wikitext
            })
        ])
        // Save HTML last, so that any error in metadata storage suppresses
        // HTML.
        .then(function() {
            return hyper.put({
                uri: self.getBucketURI(rp, 'stash.html', tid, true),
                headers: original.body.html.headers,
                body: original.body.html.body
            });
        })
        // Add the ETag to the original response so it can be propagated
        // back to the client
        .then(function() {
            original.body.html.headers.etag = mwUtil.makeETag(rp.revision, tid, 'stash');
            return original;
        });
    });
};

PSP.callParsoidTransform = function callParsoidTransform(hyper, req, from, to) {
    var rp = req.params;
    var parsoidTo = to;
    if (to === 'html') {
        // Retrieve pagebundle whenever we want HTML
        parsoidTo = 'pagebundle';
    }

    var parsoidExtras = [];
    if (rp.title) {
        parsoidExtras.push(rp.title);
    } else {
        // Fake title to avoid Parsoid error: <400/No title or wikitext was provided>
        parsoidExtras.push('Main_Page');
    }
    if (rp.revision && rp.revision !== '0') {
        parsoidExtras.push(rp.revision);
    }
    var parsoidExtraPath = parsoidExtras.map(encodeURIComponent).join('/');
    if (parsoidExtraPath) { parsoidExtraPath = '/' + parsoidExtraPath; }

    var parsoidReq = {
        uri: this.parsoidHost + '/' + rp.domain + '/v3/transform/'
            + from + '/to/' + parsoidTo + parsoidExtraPath,
        headers: {
            'content-type': 'application/json',
            'user-agent': req['user-agent'],
        },
        body: req.body
    };

    var transformPromise = hyper.post(parsoidReq);
    if (req.body.stash && from === 'wikitext' && to === 'html') {
        return this.stashTransform(hyper, req, transformPromise);
    }
    return transformPromise;

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

PSP.makeTransform = function(from, to) {
    var self = this;

    return function(hyper, req) {
        var rp = req.params;
        if ((!req.body && req.body !== '')
                || (!req.body[from] && req.body[from] !== '')) {
            throw new HTTPError({
                status: 400,
                body: {
                    type: 'bad_request',
                    description: 'Missing request parameter: ' + from
                }
            });
        }
        // check if we have all the info for stashing
        if (req.body.stash) {
            if (!rp.title) {
                throw new HTTPError({
                    status: 400,
                    body: {
                        type: 'bad_request',
                        description: 'Data can be stashed only for a specific title.'
                    }
                });
            }
            if (!rp.revision) {
                rp.revision = '0';
            }
        }

        var transform;
        if (rp.revision && rp.revision !== '0') {
            transform = self.transformRevision(hyper, req, from, to);
        } else {
            transform = self.callParsoidTransform(hyper, req, from, to);
        }
        return transform
        .catch(function(e) {
            // In case a page was deleted/revision restricted while edit was happening,
            // return 410 Gone or 409 Conflict error instead of a general 400
            var pageDeleted = e.status === 404 && e.body
                    && /Page was deleted/.test(e.body.description);
            var revisionRestricted = e.status === 403 && e.body
                    && /Access is restricted/.test(e.body.description);
            if (pageDeleted || revisionRestricted) {
                throw new HTTPError({
                    status: pageDeleted ? 410 : 409,
                    body: {
                        type: 'conflict',
                        title: 'Conflict detected',
                        description: e.body.description
                    }
                });
            }
            throw e;
        })
        .then(function(res) {
            if (to !== 'wikitext') {
                // Unwrap to the flat response format
                res = res.body[to];
                res.status = 200;
            }
            // normalise the content type
            mwUtil.normalizeContentType(res);
            // remove the content-length header since that
            // is added automatically
            delete res.headers['content-length'];
            return res;
        });
    };
};

module.exports = function(options) {
    options = options || {};
    // Default to key_rev_value for now, switch to key_rev_latest_value later.
    options.bucket_type = options.bucket_type || 'key_rev_value';
    var ps = new ParsoidService(options);

    return {
        spec: spec,
        operations: ps.operations,
        // Dynamic resource dependencies, specific to implementation
        resources: [
            {
                uri: '/{domain}/sys/' + options.bucket_type + '/parsoid.html',
                body: {
                    revisionRetentionPolicy: {
                        type: 'latest',
                        count: 1,
                        grace_ttl: 86400
                    },
                    valueType: 'blob',
                    version: 1
                }
            },
            {
                uri: '/{domain}/sys/' + options.bucket_type + '/parsoid.wikitext',
                body: {
                    valueType: 'blob'
                }
            },
            {
                uri: '/{domain}/sys/' + options.bucket_type + '/parsoid.data-parsoid',
                body: {
                    revisionRetentionPolicy: {
                        type: 'latest',
                        count: 1,
                        grace_ttl: 86400
                    },
                    valueType: 'json',
                    version: 1
                }
            },
            {
                uri: '/{domain}/sys/' + options.bucket_type + '/parsoid.section.offsets',
                body: {
                    revisionRetentionPolicy: {
                        type: 'latest',
                        count: 1,
                        grace_ttl: 86400
                    },
                    valueType: 'json',
                    version: 1
                }
            },
            {
                uri: '/{domain}/sys/' + options.bucket_type + '/parsoid.data-mw',
                body: {
                    valueType: 'json'
                }
            },
            // stashing resources for HTML, wikitext and data-parsoid
            {
                uri: '/{domain}/sys/key_rev_value/parsoid.stash.html',
                body: {
                    revisionRetentionPolicy: {
                        type: 'ttl',
                        ttl: 86400
                    },
                    valueType: 'blob',
                    version: 1
                }
            },
            {
                uri: '/{domain}/sys/key_rev_value/parsoid.stash.wikitext',
                body: {
                    revisionRetentionPolicy: {
                        type: 'ttl',
                        ttl: 86400
                    },
                    valueType: 'blob',
                    version: 1
                }
            },
            {
                uri: '/{domain}/sys/key_rev_value/parsoid.stash.data-parsoid',
                body: {
                    revisionRetentionPolicy: {
                        type: 'ttl',
                        ttl: 86400
                    },
                    valueType: 'json',
                    version: 1
                }
            }
        ]
    };
};
