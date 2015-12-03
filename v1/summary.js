'use strict';

var yaml = require('js-yaml');
var fs = require('fs');
var spec = yaml.safeLoad(fs.readFileSync(__dirname + '/summary.yaml'));

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
            }
        }
    };
};
