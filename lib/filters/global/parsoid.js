'use strict';

/*
 * Simple wrapper for Parsoid
 */

function pagebundle(parsoidHost, restbase, domain, key, rev) {
    var uri = parsoidHost + '/v2/' + domain + '/' + key + '/pagebundle/' + rev;
    return restbase.get({ uri: uri });
}

module.exports = function (conf) {
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
            }
        }
    };
};
