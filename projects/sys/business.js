'use strict';

const HyperSwitch = require('hyperswitch');
const loader = require('../../lib/loader_module.js');

const spec = HyperSwitch.utils.loadSpec(`${__dirname}/business.yaml`);

module.exports = (options) => {
    return loader(spec, options);
};
