'use strict';

/*
 * Simple wrapper for Parsoid
 */

// XXX: extract this out into some kind of top-level configuration
var parsoidHost = 'http://parsoid-lb.eqiad.wikimedia.org';

function isCacheMissForced(req) {
  return    req.headers
         && req.headers['cache-control']
         && (/no-cache/).test(req.headers['cache-control']);
}

function getPagebundleFromParsoid(restbase, req) {
    var domain = req.params.domain;
    var key = req.params.key;
    var rev = req.params.revision;
    var uri = parsoidHost + '/v2/' + domain + '/' + key + '/pagebundle/' + rev;
    return restbase.get({ uri: uri });
}

function getPagebundle(restbase, req) {
    if (isCacheMissForced(req)) {
        return getPagebundleFromParsoid(restbase, req);
    } else {
        return restbase.get({ uri: req.uri });
    }
}


module.exports = {
    paths: {
        '/v1/{domain}/{bucket}/{key}/{format}/{revision}': {
            get: { request_handler: getPagebundle }
        },
        '/v1/{domain}/_svc/parsoid/{key}/{revision}': {
            get: { request_handler: getPagebundleFromParsoid }
        }
    }
};
