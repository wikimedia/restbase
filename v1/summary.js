'use strict';

var HyperSwitch = require('hyperswitch');
var spec = HyperSwitch.utils.loadSpec(__dirname + '/summary.yaml');

module.exports = function(options, templates) {
    return {
        spec: spec,
        globals: {
            options: options,
            // Add a utility function to the global scope, so that it can be
            // called in the response template.
            httpsSource: function(thumb) {
                if (thumb && thumb.source) {
                    thumb.source = thumb.source.replace(/^http:/, 'https:');
                }
                return thumb;
            },
            getTimestamp: function(items) {
                return items && items[0] && items[0].timestamp
            }
        }
    };
};
