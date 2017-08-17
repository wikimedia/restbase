"use strict";

const P = require('bluebird');

/**
 * Filter adding security-relevant response headers like CSP.
 */

function isHtmlSvgContent(res) {
    return res.headers && /^(?:text\/html|image\/svg)/i.test(res.headers['content-type']);
}

const cspHeaderVariants = [
    'content-security-policy',
    // For IE 10 & 11
    'x-content-security-policy',
    // For Chrome <= v25 (<<1% traffic; todo: revisit support)
    'x-webkit-csp',
];

/**
 * Replaces subdomain with a wildcard
 * @param {string} domain a full domain name (e.g. en.wikipedia.org)
 * @return {string} wildcard version (e.g. *.wikipedia.org)
 */
function wildcardSubdomain(domain) {
    if ((domain.match(/\./g) || []).length >= 2) {
        return `*.${domain.replace(/^[^.]+\./, "")}`;
    } else {
        return domain;
    }
}

/**
 * Adds Content-Security-Policy & related headers to send in response
 * @param {HyperSwitch} hyper the HyperSwitch object
 * @param {Object} req the request to handle
 * @param {P} next the promise to execute
 * @param {Object} options options containing the following fields:
 *                - allowInline: if true 'unsafe-inline' is added to style-src
 */
module.exports = function addCSPHeaders(hyper, req, next, options) {
    let resPromise;
    if (req.method === 'options') {
        resPromise = P.resolve({
            status: 200,
            headers: {}
        });
    } else {
        resPromise = next(hyper, req);
    }

    return resPromise.then((res) => {
        if (!res.headers) {
            res.headers = {};
        }
        const rh = res.headers;

        // Set up basic CORS headers
        rh['access-control-allow-origin'] = '*';
        rh['access-control-allow-methods'] = 'GET,HEAD';
        rh['access-control-allow-headers'] =
            'accept, content-type, content-length, cache-control, accept-language, ' +
            'api-user-agent, if-match, if-modified-since, if-none-match, ' +
            // There's a bug in Safari 9 that makes it require these as allowed headers
            'dnt, accept-encoding';
        rh['access-control-expose-headers'] = 'etag';

        // Set up security headers
        // https://www.owasp.org/index.php/List_of_useful_HTTP_headers
        rh['x-content-type-options'] = 'nosniff';
        rh['x-frame-options'] = 'SAMEORIGIN';

        // Restrict referrer forwarding
        // (https://phabricator.wikimedia.org/T173509)
        rh['referrer-policy'] = 'origin-when-cross-origin';

        let csp;
        if (isHtmlSvgContent(res)) {
            // Let backend services override CSP headers for HTML / SVG
            // XXX: Re-consider this policy
            if (rh['content-security-policy']) {
                csp = rh['content-security-policy'];
            } else {
                // Our main production clients will ignore CSP anyway (by loading via
                // XHR or fetch), so we need to sanitize our HTML assuming that no
                // CSP is enforced on the client. This means that we might actually
                // gain some security by convincing some users to load HTML in frames,
                // and thus actually enforce CSP. It is also useful to preview content
                // in the browser.
                let styleSource;
                if (hyper._rootReq && hyper._rootReq.params.domain) {
                    styleSource = wildcardSubdomain(hyper._rootReq.params.domain);
                    styleSource = `http://${styleSource} https://${styleSource}`;
                } else {
                    styleSource = '*';
                }
                csp = `default-src 'none'; media-src *; img-src *; style-src ${styleSource}`
                    + `${options && options.allowInlineStyles ? " 'unsafe-inline'" : ""};`
                    + `frame-ancestors 'self'`;
            }
        } else {
            // Other content: Disallow everything, especially framing to avoid
            // re-dressing attacks.
            csp = "default-src 'none'; frame-ancestors 'none'";
        }
        rh['x-xss-protection'] = '1; mode=block';

        // Finally, assign the csp header variants
        cspHeaderVariants.forEach((name) => { rh[name] = csp; });
        return res;
    });
};
