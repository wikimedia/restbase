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

function pagebundle(parsoidHost, restbase, domain, title, revision) {
    var uri = parsoidHost + '/v2/' + domain + '/pagebundle/' + title + '/' + revision;
    return restbase.get({ uri: uri });
}

function saveParsoidResult(restbase, domain, bucket, title, format, tid) {
    return function (parsoidResp) {
        // handle the response from Parsoid
        if (parsoidResp.status === 200) {
            parsoidResp.headers.etag = tid;
            Promise.all([
                restbase.put({
                    uri: '/v1/' + domain + '/' + bucket + '.html/' + title + '/' + tid,
                    headers: rbUtil.extend({}, parsoidResp.headers, {'content-type': contentTypes.html}),
                    body: parsoidResp.body.html
                }),
                restbase.put({
                    uri: '/v1/' + domain + '/' + bucket + '.data-parsoid/' + title + '/' + tid,
                    headers: rbUtil.extend({}, parsoidResp.headers, {'content-type': contentTypes['data-parsoid'] }),
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
}

function generateAndSave(restbase, domain, bucket, title, format, revision, tid) {
    // Try to generate HTML on the fly by calling Parsoid
    return restbase.get({
        uri: '/v1/' + domain + '/_svc/parsoid/' + title + '/' + revision
    }).then(saveParsoidResult(restbase, domain, bucket, title, format, tid));
}

function getFormat(format) {

    return function (restbase, req) {
        var domain = req.params.domain;
        var bucket = 'pages';
        var title = req.params.title;
        var revision = req.params.revision;

        if (req.headers && /no-cache/.test(req.headers['cache-control'])) {
            var tid = uuid.v1();
            return generateAndSave(restbase, domain, bucket, title, format, revision, tid);
        } else {
            var rp = req.params;
            req.uri = new URI([rp.domain,'sys','key_value','parsoid.' + format,title,revision]);
            return restbase.get(req)
            .then(function(res) {
                var tid = (res.headers || {}).etag;
                if (res.status === 404 && /^[0-9]+$/.test(revision)) {
                  return generateAndSave(restbase, domain, bucket, title, format, revision, tid);
                } else {
                  return res;
                }
            });
        }
    };
}

var getWikitext = getFormat('wikitext');
var getHtml = getFormat('html');
var getDataParsoid = getFormat('data-parsoid');

function transformRevision (restbase, req, from, to) {

    var domain = req.params.domain;
    var title    = req.params.title;
    var rev    = req.params.revision;

    var fromStorage = {
        revid: rev
    };

    function get(format) {
        return restbase.get({ uri: '/v1/' + domain + '/pages/' + title + '/' + format + '/' + rev })
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
            uri: '/v1/' + domain + '/transform/' + from + '/to/' + to,
            headers: { 'content-type': 'application/json' },
            body: body2
        });
    });

}

function transform(parsoidHost, from, to) {
    return function (restbase, req, revision) {
        if (req.params.revision) {
            return transformRevision(restbase, req, from, to);
        } else {
            // Parsoid currently spells 'wikitext' as 'wt'
            var parsoidTo = (to === 'wikitext') ? 'wt' : to;

            // fake title to avoid Parsoid error: <400/No title or wikitext was provided>
            var parsoidExtra = (from === 'html') ? '/_' : '';

            return restbase.post({
                uri: parsoidHost + '/v2/' + req.params.domain + '/' + parsoidTo + parsoidExtra,
                headers: { 'content-type': 'application/json' },
                body: req.body
            });
        }
    };
}


module.exports = function (conf) {
    if (!conf.parsoidHost) {
        conf.parsoidHost = 'http://parsoid-lb.eqiad.wikimedia.org';
    }
    return {
        spec: {
            paths: {
                '/pagebundle/{title}/{/revision}': {
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
                var domain = req.params.domain;
                var title = req.params.title;
                var rev = req.params.rev;
                return pagebundle(conf.parsoidHost, restbase, domain, title, rev);
            },
            getWikitext: getWikitext,
            getHtml: getHtml,
            getDataParsoid: getDataParsoid,
            transformHtmlToHtml: transform(conf.parsoidHost, 'html', 'html'),
            transformHtmlToWikitext: transform(conf.parsoidHost, 'html', 'wikitext'),
            transformWikitextToHtml: transform(conf.parsoidHost, 'wikitext', 'html')
        }
    };
};
