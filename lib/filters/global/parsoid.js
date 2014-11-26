'use strict';

/*
 * Simple wrapper for Parsoid
 */

// XXX: extract this out into some kind of top-level configuration
var parsoidHost = 'http://parsoid-lb.eqiad.wikimedia.org';

function pagebundle(restbase, domain, key, rev) {
    var uri = parsoidHost + '/v2/' + domain + '/' + key + '/pagebundle/' + rev;
    return restbase.get({ uri: uri });
}

module.exports = {
    paths: {
        '/v1/{domain}/_svc/parsoid/{key}/{rev}': {
            get: {
                request_handler: function(restbase, req) {
                    var domain = req.params.domain;
                    var key = req.params.key;
                    var rev = req.params.rev;
                    return pagebundle(restbase, domain, key, rev);
                }
            }
        }
    }
};
