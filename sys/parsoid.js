'use strict';

const HyperSwitch = require('hyperswitch');

const Parsoid = require('../lib/parsoid.js');
const spec = HyperSwitch.utils.loadSpec(`${__dirname}/parsoid.yaml`);

module.exports = (options) => {
    options = options || {};
    const ps = new Parsoid(options);
    return {
        spec,
        operations: {
            // Revision retrieval per format
            getHtml: ps.getFormat.bind(ps, 'html'),
            getDataParsoid: ps.getFormat.bind(ps, 'data-parsoid'),
            getLintErrors: ps.getLintErrors.bind(ps),
            // Transforms
            transformHtmlToHtml: ps.makeTransform('html', 'html'),
            transformHtmlToWikitext: ps.makeTransform('html', 'wikitext'),
            transformWikitextToHtml: ps.makeTransform('wikitext', 'html'),
            transformWikitextToLint: ps.makeTransform('wikitext', 'lint'),
            transformChangesToWikitext: ps.makeTransform('changes', 'wikitext')
        },
        // Dynamic resource dependencies, specific to implementation
        resources: [
            {
                uri: '/{domain}/sys/key_value/parsoid',
                headers: {
                    'content-type': 'application/json'
                },
                body: {
                    valueType: 'blob'
                }
            },
            {
                uri: '/{domain}/sys/key_value/parsoid-stash',
                headers: {
                    'content-type': 'application/json'
                },
                body: {
                    valueType: 'blob',
                    default_time_to_live: options.grace_ttl || 86400
                }
            }
        ]
    };
};
