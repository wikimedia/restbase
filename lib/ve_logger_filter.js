'use strict';

module.exports = (hyper, req, next, options, specInfo) => {

    options.probability = options.probability || 1;
    const ua = req.headers && req.headers['user-agent'] || '';
    const aua = req.headers && req.headers['api-user-agent'] || '';

    if (`${ua}|${aua}`.includes('VisualEditor') &&
            Math.floor(1000 * Math.random()) <= Math.floor(1000 * options.probability)) {
        hyper.logger.log('warn/visualeditor', {
            msg: 'VisualEditor request',
            req_headers: JSON.stringify(req.headers, null, 2)
        });
    }

    return next(hyper, req);

};
