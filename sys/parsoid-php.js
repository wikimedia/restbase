'use strict';

const HyperSwitch = require('hyperswitch');

const Parsoid = require('../lib/parsoid.js');
const spec = HyperSwitch.utils.loadSpec(`${__dirname}/parsoid.yaml`);

const URI = HyperSwitch.URI;

class ParsoidPHP extends Parsoid {

    /**
     * Assembles the request that is to be used to call the Parsoid service
     *
     * @param {Object} req the original request received by the module
     * @param {string} path the path portion of the URI, without the domain or API version
     * @param {Object} [headers] the headers to send, defaults to req.headers
     * @param {Object} [body] the body of the request, defaults to undefined
     * @return {Object} the request object to send
     */
    _getParsoidReq(req, path, headers, body) {
        return {
            uri: new URI(`${this.parsoidUri}/${req.params.domain}/v3/${path}`),
            headers: Object.assign({ host: req.params.domain }, headers || req.headers),
            body
        };
    }

    /**
     * Gets the URI of a bucket for the latest Parsoid content
     *
     * @param {string} domain the domain name
     * @param {string} title the article title
     * @return {HyperSwitch.URI}
     */
    _getLatestBucketURI(domain, title) {
        return new URI([
            domain, 'sys', 'key_value', 'parsoidphp', title
        ]);
    }

    /**
     * Gets the URI of a bucket for stashing Parsoid content. Used both for stashing
     * original HTML/Data-Parsoid for normal edits as well as for stashing transforms
     *
     * @param {string} domain the domain name
     * @param {string} title the article title
     * @param {number} revision the revision of the article
     * @param {string} tid the TID of the content
     * @return {HyperSwitch.URI}
     */
    _getStashBucketURI(domain, title, revision, tid) {
        return new URI([
            domain, 'sys', 'key_value', 'parsoidphp-stash', `${title}:${revision}:${tid}`
        ]);
    }

    getFormatAndCheck(format, hyper, req) {
        return this.getFormat(format, hyper, req)
        .tap((res) => {
            // TEMP TEMP TEMP: T236382 / T221174 shim content-language and vary if missing
            if (!res.headers['content-language'] || !res.headers.vary) {
                hyper.logger.log('warn/parsoidphp/headers', {
                    msg: 'Missing Content-Language or Vary header in pb.body.html.headers'
                });
            }
            res.headers['content-language'] = res.headers['content-language'] || 'en';
            res.headers.vary = res.headers.vary || 'Accept';
            // END TEMP
        });
    }

}

module.exports = (options = {}) => {
    const ps = new ParsoidPHP(options);
    return {
        spec,
        operations: {
            // Revision retrieval per format
            getHtml: ps.getFormatAndCheck.bind(ps, 'html'),
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
                uri: '/{domain}/sys/key_value/parsoidphp',
                headers: {
                    'content-type': 'application/json'
                },
                body: {
                    valueType: 'blob'
                }
            },
            {
                uri: '/{domain}/sys/key_value/parsoidphp-stash',
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
