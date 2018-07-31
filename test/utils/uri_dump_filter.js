"use strict";

const fs = require('fs');

module.exports = function(hyper, req, next, options) {
    if (options.dump_test_uris && req.method === 'get') {
        let uri = req.uri.toString();
        if (req.query && Object.keys(req.query).length) {
            uri += `?${Object.keys(req.query).map((queryParam) => {
                return `${queryParam}=${encodeURIComponent(req.query[queryParam])}`;
            }).join('&')}`;
        }
        fs.appendFileSync(options.filepath, `${uri}\n`);
    }
    return next(hyper, req);
};
