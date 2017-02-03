'use strict';

const HyperSwitch = require('hyperswitch');
const spec = HyperSwitch.utils.loadSpec(`${__dirname}/summary.yaml`);

module.exports = (options) => ({
    spec,
    globals: {
        options,
        // Add a utility function to the global scope, so that it can be
        // called in the response template.
        httpsSource(thumb) {
            if (thumb && thumb.source) {
                thumb.source = thumb.source.replace(/^http:/, 'https:');
            }
            return thumb;
        },
        getRevision(revItems) {
            if (Array.isArray(revItems) && revItems.length) {
                return revItems[0];
            }
            return {};
        },
        extractDescription(terms) {
            if (terms && terms.description && terms.description.length) {
                return terms.description[0];
            }
        },
        processCoords(coords) {
            if (!coords || !coords.length) {
                return undefined;
            }

            const coord = coords[0];
            delete coord.primary;
            delete coord.globe;
            return coord;
        }
    }
});
