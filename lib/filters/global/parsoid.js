'use strict';

/*
 * Simple wrapper for Parsoid
 */

var rbUtil = require('../../util.js');
var contentTypes = {
    html: 'text/html; charset=UTF-8',
    'data-parsoid': 'application/json; profile=mediawiki.org/specs/data-parsoid/1.0'
};

function pagebundle(parsoidHost, restbase, domain, key, rev) {
    // TODO: this is a hack to allow us to test with a safe/fake domain, but 
    // still call out to a real service
    if (domain === 'en.wikipedia.test.local') {
        domain = 'en.wikipedia.org';
    }
    var uri = parsoidHost + '/v2/' + domain + '/' + key + '/pagebundle/' + rev;
    return restbase.get({ uri: uri });
}

function saveParsoidResult(restbase, domain, bucket, key, format, tid) {
    return function (parsoidResp) {
        // handle the response from Parsoid
        if (parsoidResp.status === 200) {
            parsoidResp.headers.etag = tid;
            Promise.all([
                restbase.put({
                    uri: '/v1/' + domain + '/' + bucket + '.html/' + key + '/' + tid,
                    headers: rbUtil.extend({}, parsoidResp.headers, {'content-type': contentTypes.html}),
                    body: parsoidResp.body.html
                }),
                restbase.put({
                    uri: '/v1/' + domain + '/' + bucket + '.data-parsoid/' + key + '/' + tid,
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

function getFormatRevision(format) {
    return function (restbase, req) {

        var domain = req.params.domain;
        var bucket = 'page';
        var key = req.params.key;
        var revision = req.params.revision;

        return restbase.get(req).then(function(res) {
            var tid = res.headers.etag;
            if (res.status === 404 && /^[0-9]+$/.test(revision)) {
                // Try to generate HTML on the fly by calling Parsoid
                return restbase.get({
                    uri: '/v1/' + domain + '/_svc/parsoid/' + key + '/' + revision
                }).then(saveParsoidResult(restbase, domain, bucket, key, format, tid));
            } else {
              return res;
            }

        });
    };
}

var getWikitextRevision = getFormatRevision('wikitext');
var getHtmlRevision = getFormatRevision('html');
var getDataParsoidRevision = getFormatRevision('data-parsoid');

module.exports = function (conf) {
    if (!conf.parsoidHost) {
        conf.parsoidHost = 'http://parsoid-lb.eqiad.wikimedia.org';
    }
    return {
        paths: {
            '/v1/{domain}/_svc/parsoid/{key}/{rev}': {
                get: {
                    request_handler: function(restbase, req) {
                        var domain = req.params.domain;
                        var key = req.params.key;
                        var rev = req.params.rev;
                        return pagebundle(conf.parsoidHost, restbase, domain, key, rev);
                    }
                }
            },
            '/v1/{domain}/page/{key}/wikitext/{revision}': {
                get: { request_handler: getWikitextRevision }
            },
            '/v1/{domain}/page/{key}/html/{revision}': {
                get: { request_handler: getHtmlRevision }
            },
            '/v1/{domain}/page/{key}/data-parsoid/{revision}': {
                get: { request_handler: getDataParsoidRevision }
            }
        }
    };
};
