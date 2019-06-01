'use strict';

const HyperSwitch = require('hyperswitch');

const specProxy = HyperSwitch.utils.loadSpec(`${__dirname}/../projects/sys/backend-proxy.yaml`);

function addAuthFilter(spec) {
    if (!spec.paths['/page_revisions']) {
        return;
    }
    const pageRev = spec.paths['/page_revisions'];
    pageRev['x-route-filters'] = pageRev['x-route-filters'] || [];
    pageRev['x-route-filters'].push({
        path: './lib/mediawiki_auth_filter.js'
    });
}

function hidePaths(spec) {
    const paths = spec.paths;
    Object.keys(paths).forEach((path) => {
        paths[path]['x-hidden'] = true;
    });
}

module.exports = (options) => {
    let spec = {};
    options = options || {};
    options.service_type = options.service_type || 'fullstack';
    options.proxy = options.proxy || {};
    if (!Object.prototype.hasOwnProperty.call(options, 'expose_proxy')) {
        options.proxy.expose_proxy = true;
    }
    if (options.proxy.expose_proxy) {
        switch (options.service_type.toLowerCase()) {
            case 'frontend':
                break;
            case 'backend':
                spec = specProxy;
                addAuthFilter(spec);
                break;
            case 'fullstack':
                spec = specProxy;
                addAuthFilter(spec);
                hidePaths(spec);
                break;
            default:
                throw new Error('Invalid value for option service_type supplied!');
        }
    }
    return {
        spec,
        operations: {},
        globals: { options }
    };
};
