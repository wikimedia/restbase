'use strict';

const HyperSwitch = require('hyperswitch');
const spec = HyperSwitch.utils.loadSpec(`${__dirname}/summary.yaml`);

let protocol = '//';

const functions = {
    // Add a utility function to the global scope, so that it can be
    // called in the response template.
    changeProtocol(source) {
        if (!source) {
            return source;
        }
        if (source.constructor === String) {
            source = source.replace(/^(?:https?:)?\/\//, protocol);
        } else if (Array.isArray(source)) {
            source = source.map(elem => functions.changeProtocol(elem));
        } else if (source.constructor === Object) {
            Object.keys(source).filter(key => !/title/.test(key)).forEach((key) => {
                source[key] = functions.changeProtocol(source[key]);
            });
        }
        return source;
    }
};

module.exports = (options) => {
    if (options.protocol === 'http') {
        protocol = 'http://';
    } else if (options.protocol === 'https') {
        protocol = 'https://';
    }
    return { spec, globals: Object.assign({ options }, functions) };
};
