"use strict";


module.exports = function(options) {
    options.conf.backend = options.conf.backend || 'cassandra';

    if (options.conf.backend !== 'cassandra'
            && options.conf.backend !== 'sqlite') {
        throw new Error('Unsupported backend version specified: ' + options.backend);
    }

    return require('restbase-mod-table-' + options.conf.backend)(options);
};
