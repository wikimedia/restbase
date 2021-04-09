'use strict';

/*
 * A simple wrapper module over storage modules which allows to switch between storage
 * implementation using a config option.
 */

module.exports = (options) => {
    options.conf.backend = options.conf.backend || 'cassandra';
    options.log = options.logger.log.bind(options.logger);

    if (
        options.conf.backend !== 'cassandra' &&
        options.conf.backend !== 'mysql' &&
        options.conf.backend !== 'sqlite'
    ) {
        throw new Error(`Unsupported backend version specified: ${options.conf.backend}`);
    }

    return require(`restbase-mod-table-${options.conf.backend}`)(options);
};
