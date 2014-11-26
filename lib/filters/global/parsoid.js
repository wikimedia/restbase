'use strict';

/*
 * Simple wrapper for Parsoid
 */

module.exports = {
    paths: {
        '/v1/{domain}/services/parsoid/{key}/{rev}': {
            get: {
                request_handler: function(restbase, req) {
                    var rp = req.params;
                    var parsoidURL = 'http://parsoid-lb.eqiad.wikimedia.org/v2/' + rp.domain + '/' + rp.key + '/pagebundle/' + rp.rev;
                    return restbase.get({ uri: parsoidURL });
                }
            }
        }
    }
};
