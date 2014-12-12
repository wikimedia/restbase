'use strict';

/*
 * Simple wrapper for Parsoid
 */

var rbUtil = require('../../rbUtil.js');
var contentTypes = {
    html: 'text/html; charset=UTF-8',
    'data-parsoid': 'application/json; profile=mediawiki.org/specs/data-parsoid/1.0'
};

function isCacheMissForced(req) {
  return    req.headers
         && req.headers['cache-control']
         && (/no-cache/).test(req.headers['cache-control']);
}

function updateRevTable(restbase, domain, bucket, key, revision, userId, userText, comment, tid) {
    return restbase.put({ // Save / update the revision entry
        uri: '/v1/' + domain + '/' + bucket + '.rev' + '/' + key,
        body: {
            table: bucket + '.rev',
            attributes: {
                page: key,
                rev: parseInt(revision),
                tid: tid,
                user_id: userId,
                user_text: userText,
                comment: comment
            }
        }
    });
}

function resolveMWOldid(restbase, domain, revision) {
    // Try to resolve MW oldids to tids
    return restbase.post({
        uri: '/v1/' + domain + '/_svc/action/query',
        body: {
            format: 'json',
            action: 'query',
            prop: 'revisions',
            rvprop: 'ids|timestamp|user|userid|size|sha1|contentmodel|comment',
                //titles: rp.key,
            revids: revision
        }
    })
    .then(function(apiRes) {
        if (apiRes.status === 200) {
            var apiRev = apiRes.body.items[0].revisions[0];
            return {
                tid: rbUtil.tidFromDate(new Date(apiRev.timestamp)),
                userId: apiRev.userid,
                userText: apiRev.user,
                comment: apiRev.comment
            };
        } else {
            throw new Error("Couldn't resolve MW oldid", apiRes);
        }
        });
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

function getPagebundleFromParsoid(parsoidHost) {
    return function (restbase, req) {
        var domain = req.params.domain;

        // TODO: this is a hack to allow us to test with a safe/fake domain, but
        // still call out to a real service
        if (domain === 'en.wikipedia.test.local') {
            domain = 'en.wikipedia.org';
        }
        var key = req.params.key;
        var rev = req.params.revision;
        var uri = parsoidHost + '/v2/' + domain + '/' + key + '/pagebundle/' + rev;
        return restbase.get({ uri: uri });
    };
}


function getFormatRevision(parsoidHost, format) {
    return function (restbase, req) {

        var domain = req.params.domain;
        var bucket = 'pages';
        var key = req.params.key;
        var revision = req.params.revision;

        if (isCacheMissForced(req)) {
            var tid = rbUtil.tidFromDate(new Date('2014-12-11T16:35:33Z'));
            return resolveMWOldid(restbase, domain, revision)
            .then(function (res) {
                return updateRevTable(restbase, domain, bucket, key, revision, res.userId, res.userText, res.comment, tid);
            }).then(function (res) {
                return restbase.get({ uri: '/v1/' + domain + '/_svc/parsoid/' + key + '/' + revision })
                .then(saveParsoidResult(restbase, domain, bucket, key, format, tid));
            });
        } else {
        return restbase.get(req).then(function(res) {
            if (res.status === 404 && /^[0-9]+$/.test(revision)) {
                var tid = res.headers.etag;
                // Try to generate HTML on the fly by calling Parsoid
                return restbase.get({ uri: '/v1/' + domain + '/_svc/parsoid/' + key + '/' + revision })
                .then(saveParsoidResult(restbase, domain, bucket, key, format, tid));
            } else {
                return res;
            }
        });
        }
    };
}

function parsoidHandler(conf) {
    if (!conf.parsoidHost) {
        conf.parsoidHost = 'http://parsoid-lb.eqiad.wikimedia.org';
    }
    return {
        getPagebundleFromParsoid : getPagebundleFromParsoid(conf.parsoidHost),
        getWikitextRevision      : getFormatRevision(conf.parsoidHost, 'wikitext'),
        getHtmlRevision          : getFormatRevision(conf.parsoidHost, 'html'),
        getDataParsoidRevision   : getFormatRevision(conf.parsoidHost, 'data-parsoid')
    };
}

module.exports = function (conf) {
    var handler = parsoidHandler(conf);
    return {
        paths: {
            '/v1/{domain}/_svc/parsoid/{key}/{revision}': {
                get: { request_handler: handler.getPagebundleFromParsoid }
            },
            '/v1/{domain}/pages/{key}/wikitext/{revision}': {
                get: { request_handler: handler.getWikitextRevision }
            },
            '/v1/{domain}/pages/{key}/html/{revision}': {
                get: { request_handler: handler.getHtmlRevision }
            },
            '/v1/{domain}/pages/{key}/data-parsoid/{revision}': {
                get: { request_handler: handler.getDataParsoidRevision }
            }
        }
    };
};
