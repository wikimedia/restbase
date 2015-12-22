"use strict";

var util = require('util');

var exports = {};

/*
 * Error instance wrapping HTTP error responses
 *
 * Has the same properties as the original response.
 */
function HTTPError(response) {
    Error.call(this);
    Error.captureStackTrace(this, HTTPError);
    this.name = this.constructor.name;
    this.message = response.status + '';
    if (response.body && response.body.type) {
        this.message += ': ' + response.body.type;
    }
    Object.assign(this, response);
}
util.inherits(HTTPError, Error);
exports.HTTPError = HTTPError;

exports.misc = {};

/**
 * Replaces subdomain with a wildcard
 *
 * @param domain a full domain name (e.g. en.wikipedia.org)
 * @returns {string} wildcard version (e.g. *.wikipedia.org)
 */
function wildcardSubdomain(domain) {
    if ((domain.match(/\./g) || []).length >= 2) {
        return '*.' + domain.replace(/^[^.]+\./, "");
    } else {
        return domain;
    }
}

function isHtmlSvgContent(res) {
    return res.headers
    && /^(?:text\/html|image\/svg)/i.test(res.headers['content-type']);
}

var cspHeaderVariants = [
    'content-security-policy',
    // For IE 10 & 11
    'x-content-security-policy',
    // For Chrome <= v25 (<<1% traffic; todo: revisit support)
    'x-webkit-csp',
];

/**
 * Adds Content-Security-Policy & related headers to send in response
 *
 * @param res response object
 * @param options options containing the following fields:
 *                - domain: the domain to allow. If undefined, '*' is allowed
 *                - allowInline: if true 'unsafe-inline' is added to style-src
 */
exports.misc.addCSPHeaders = function(res, options) {
    if (!res.headers) {
        res.headers = {};
    }
    var rh = res.headers;
    var csp;
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
            var styleSource;
            if (options.domain) {
                styleSource = wildcardSubdomain(options.domain);
                styleSource = 'http://' + styleSource + ' https://' + styleSource;
            } else {
                styleSource = '*';
            }
            csp = "default-src 'none'; media-src *; img-src *; style-src "
                    + styleSource
                    + (options && options.allowInline ? " 'unsafe-inline'" : "")
                    + "; frame-ancestors 'self'";
        }
    } else {
        // Other content: Disallow everything, especially framing to avoid
        // re-dressing attacks.
        csp = "default-src 'none'; frame-ancestors 'none'";
    }
    rh['x-xss-protection'] = '1; mode=block';

    // Finally, assign the csp header variants
    cspHeaderVariants.forEach(function(name) {
        rh[name] = csp;
    });
};

module.exports = exports;