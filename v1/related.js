'use strict';

const HyperSwitch = require('hyperswitch');
const spec = HyperSwitch.utils.loadSpec(`${__dirname}/related.yaml`);

module.exports = (options) => ({
    spec,
    globals: {
        options,
        // Add a utility function to the global scope, so that it can be
        // called in the response template.
        httpsSource(items) {
            items.forEach((item) => {
                if (item.thumbnail && item.thumbnail.source) {
                    item.thumbnail.source = item.thumbnail.source.replace(/^http:/, 'https:');
                }
            });
            return items;
        }
    }
});

