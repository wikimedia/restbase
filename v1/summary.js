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
            source = source.map((elem) => functions.changeProtocol(elem));
        } else if (source.constructor === Object) {
            Object.keys(source).filter((key) => !/title/.test(key)).forEach((key) => {
                source[key] = functions.changeProtocol(source[key]);
            });
        }
        return source;
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
            return '';
        }

        return entities.decodeHTML(extract.replace(TAGS_MATCH, ''));
    }
};

module.exports = (options) => {
    if (options.protocol === 'http') {
        protocol = 'http://';
    } else if (options.protocol === 'https') {
        protocol = 'https://';
    }

    const disabledStorage = options.disabled_storage || false;

    let summarySpec = spec;
    if (options.implementation === 'mcs') {
        summarySpec = newSpec;

        // restbase sunset: Make page summary requests passthrough
        // to mobileapps service
        if (disabledStorage) {
            // Filter out storage related handlers and keep only requests to backend
            let handlers = summarySpec.paths['/summary/{title}'].get['x-request-handler'];
            handlers = handlers.filter((elem) => Object.keys(elem).includes('extract'));
            delete handlers[0].extract.response;
            handlers[0].extract.return = {
                status: 200,
                headers: {
                    etag: '{{extract.headers.etag}}',
                    vary: '{{extract.headers.vary}}',
                    'cache-control': '{{options.response_cache_control}}',
                    'content-language': '{{extract.headers.content-language}}',
                    'content-type': '{{extract.headers.content-type}}',
                    'x-restbase-sunset': 'true'
                },
                body: '{{changeProtocol(extract.body)}}'
            };
            summarySpec.paths['/summary/{title}'].get['x-request-handler'] = handlers;
        }
    }

    return {
        spec: summarySpec,
        globals: Object.assign({ options }, functions)
    };
};
