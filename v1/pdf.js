'use strict';

const HyperSwitch = require('hyperswitch');
const spec = HyperSwitch.utils.loadSpec(`${__dirname}/pdf.yaml`);

/**
 * PDF filename formatting / escaping utilities.
 */

module.exports = options => ({
    spec,
    globals: {
        options,
        filenameParameters(name) {
            // Return two parameters
            const encodedName = `${encodeURIComponent(name)}.pdf`;
            const quotedName = `"${encodedName.replace(/"/g, '\\"')}"`;
            return `filename=${quotedName}; filename*=UTF-8''${encodedName}`;
        }
    }
});
