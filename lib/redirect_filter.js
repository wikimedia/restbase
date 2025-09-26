'use strict';

const redirectLocation = (redirectTarget, uri) => {
    const uriArray = uri.split('/');
    uriArray[1] = redirectTarget;
    return uriArray.join('/');
};

module.exports = (hyper, req, next, options) => {
    const redirectSource = req.params.domain || `${req.uri}`.split('/')[1];
    if (redirectSource in options) {
        return {
            status: 301,
            headers: {
                location: redirectLocation(options[redirectSource], `${req.uri}`)
            }
        };
    }
    return next(hyper, req);
};
