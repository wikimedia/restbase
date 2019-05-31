'use strict';

const HyperSwitch = require('hyperswitch');
const loader = require('../../lib/loader_module.js');

const specStorage = HyperSwitch.utils.loadSpec(`${__dirname}/backend-storage.yaml`);
const specProxy = HyperSwitch.utils.loadSpec(`${__dirname}/backend-proxy.yaml`);

module.exports = (options) => {
    let spec;
    options = options || {};
    options.service_type = options.service_type || 'fullstack';
    switch (options.service_type.toLowerCase()) {
        case 'frontend':
            spec = specProxy;
            break;
        case 'backend':
        case 'fullstack':
            spec = specStorage;
            break;
        default:
            throw new Error('Invalid value for option service_type supplied!');
    }
    return loader(spec, options);
};
