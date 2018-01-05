'use strict';

const HyperSwitch = require('hyperswitch');
const spec = HyperSwitch.utils.loadSpec(`${__dirname}/summary.yaml`);
const newSpec = HyperSwitch.utils.loadSpec(`${__dirname}/summary_new.yaml`);
const entities = require('entities');

/**
 * A RegExp to match all the tags with attributes.
 *
 * A tag starts with < and a letter, contains of a number of alphanumeric characters,
 * attributes are separated by spaces, attribute might have a value surrounded by ' or ",
 * the value is allowed to have any character.
 *
 * @const
 * @type {RegExp}
 */
const TAGS_MATCH = /<\/?[a-zA-Z][\w-]*(?:\s+[a-zA-Z_\-:]+(?:=\\?(?:"[^"]*"|'[^']*'))?)*\s*\/?>/g;

const functions = {
    // Add a utility function to the global scope, so that it can be
    // called in the response template.
    httpsSource(thumb) {
        if (!thumb) {
            return thumb;
        }
        if (thumb.source) {
            thumb.source = thumb.source.replace(/^http:/, 'https:');
        }
        if (thumb.original) {
            thumb.original = thumb.original.replace(/^http:/, 'https:');
        }
        return thumb;
    },
    httpsSourceAll(summary) {
        summary.thumbnail = functions.httpsSource(summary.thumbnail);
        summary.originalimage = functions.httpsSource(summary.originalimage);
        return summary;
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
        if (coord.lat === undefined || coord.lon === undefined) {
            // These properties are required, so double check they exist
            return undefined;
        }
        return coord;
    },
    stripTags(extract) {
        if (!extract) {
            return "";
        }

        return entities.decodeHTML(extract.replace(TAGS_MATCH, ''));
    }
};

module.exports = options => ({
    spec: options.implementation === 'mcs' ? newSpec : spec,
    globals: Object.assign({ options }, functions)
});
