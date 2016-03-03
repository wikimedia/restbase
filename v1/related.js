'use strict';

var HyperSwitch = require('hyperswitch');
var spec = HyperSwitch.utils.loadSpec(__dirname + '/related.yaml');

module.exports = function(options) {
    return {
        spec: spec,
        globals: {
            options: options,
            // Add a utility function to the global scope, so that it can be
            // called in the response template.
            httpsSource: function(items) {
                items.forEach(function(item) {
                    if (item.thumbnail && item.thumbnail.source) {
                        item.thumbnail.source = item.thumbnail.source.replace(/^http:/, 'https:');
                    }
                });
                return items;
            }
        }
    };
};

