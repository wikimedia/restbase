'use strict';

const P = require('bluebird');
const HyperSwitch = require('hyperswitch');

const mwUtil = require('../lib/mwUtil');

const HTTPError = HyperSwitch.HTTPError;
const spec = HyperSwitch.utils.loadSpec(`${__dirname}/parsoid.yaml`);

const OPERATIONS = [
    'getHtml',
    'getDataParsoid',
    'getLintErrors',
    'transformHtmlToHtml',
    'transformHtmlToWikitext',
    'transformWikitextToHtml',
    'transformWikitextToLint',
    'transformChangesToWikitext'
];

const invert = (v) => v === 'js' ? 'php' : 'js';

class ParsoidProxy {

    constructor(opts = {}) {
        const modOpts = this._initOpts(opts);
        const jsOpts = Object.assign({}, modOpts);
        const phpOpts = Object.assign({}, modOpts);
        delete jsOpts.php_host;
        phpOpts.host = phpOpts.php_host;
        delete phpOpts.php_host;
        this._initMods(jsOpts, phpOpts);
    }

    _initOpts(opts) {
        const retOpts = Object.assign({}, opts);
        retOpts.host = retOpts.host || retOpts.parsoidHost;
        if (!retOpts.host && !retOpts.php_host) {
            throw new Error('Parsoid proxy: no host option specified!');
        }
        this.options = retOpts.proxy || {};
        // possible values are 'js' and 'php'
        this.default_variant = this.options.default_variant || 'js';
        if (!['js', 'php'].includes(this.default_variant)) {
            throw new Error('Parsoid proxy: valid variants are js and php!');
        }
        // possible values are 'single', 'mirror' and 'split'
        this.mode = this.options.mode || 'single';
        if (!['single', 'mirror', 'split'].includes(this.mode)) {
            throw new Error('Parsoid proxy: valid modes are single, mirror and split!');
        }
        this.percentage = parseFloat(this.options.percentage || 0);
        if (isNaN(this.percentage) || this.percentage < 0 || this.percentage > 100) {
            throw new Error('Parsoid proxy: percentage must a number between 0 and 100!');
        }
        if (this.percentage === 0 && this.mode === 'mirror') {
            // a special case of mirror mode with 0% is in fact the single mode
            this.mode = 'single';
        }
        this.splitRegex = mwUtil.constructRegex(this.options.pattern);
        if (!this.splitRegex && this.mode === 'split') {
            // split mode with no pattern is single mode
            this.mode = 'single';
            this.splitRegex = /^$/;
        } else if (this.mode !== 'split') {
            this.splitRegex = /^$/;
        }
        if (this.mode === 'split') {
            this.percentage = 100;
        }
        this.resources = [];
        delete retOpts.parsoidHost;
        delete retOpts.proxy;
        return retOpts;
    }

    _initMods(jsOpts, phpOpts) {
        if (!phpOpts.host) {
            if (this.mode !== 'single') {
                // php_host was not provided but the config expects
                // both modules to be functional, so error out
                throw new Error('Parsoid proxy: expected both host and php_host options!');
            }
            if (this.default_variant === 'php') {
                phpOpts.host = jsOpts.host;
                delete jsOpts.host;
            }
        }
        if (this.mode === 'mirror') {
            if (this.default_variant === 'php') {
                throw new Error('Parsoid proxy: when mirroring, only js can be the default variant!');
            }
            // js is the default, so don't let php issue dependency update events
            phpOpts.skip_updates = true;
        }
        this.mods = {
            js: this._addMod('js', jsOpts),
            php: this._addMod('php', phpOpts)
        };
    }

    _backendNotSupported() {
        throw new HTTPError({
            status: 400,
            body: {
                type: 'bad_request',
                description: 'Parsoid variant not configured!'
            }
        });
    }

    _addMod(variant, opts) {
        if (opts.host) {
            const mod = require(`./parsoid-${variant}.js`)(opts);
            // we are interested only in the operations and resources
            this.resources = this.resources.concat(mod.resources);
            return mod.operations;
        }
        // return operations that error out if no host is specified
        const ret = {};
        OPERATIONS.forEach((o) => {
            ret[o] = this._backendNotSupported;
        });
        return ret;
    }

    _getStickyVariant(hyper, req) {
        let variant = hyper._rootReq.headers['x-parsoid-variant'] ||
            req.headers['x-parsoid-variant'];
        if (!variant && hyper._rootReq.headers.cookie) {
            const match = /parsoid_variant=([^;]+)/i.exec(hyper._rootReq.headers.cookie);
            if (match) {
                variant = match[1];
            }
        }
        if (!variant) {
            return undefined;
        }
        variant = variant.toLowerCase();
        if (!['js', 'php'].includes(variant)) {
            throw new HTTPError({
                status: 400,
                body: {
                    type: 'bad_request',
                    description: `Parsoid variant ${variant} not configured!`
                }
            });
        }
        return variant;
    }

    _req(variant, operation, hyper, req, setHdr = true, sticky = false) {
        if (setHdr) {
            req.headers = req.headers || {};
            req.headers['x-parsoid-variant'] = variant;
        }
        return this.mods[variant][operation](hyper, req)
        .then((res) => {
            res.headers = res.headers || {};
            res.headers['x-parsoid-variant'] = variant;
            return P.resolve(res);
        }).catch({ status: 404 }, { status: 421 }, (e) => {
            // if we actually get a 421, we might be in trouble, so log it
            if (e.status === 421) {
                hyper.logger.log('warn/parsoidproxy/421', e);
            }
            // if we are in split mode, provide a fallback for transforms except lint
            if (!sticky && this.mode === 'split' && /transform/.test(operation) &&
                    !/Lint/.test(operation)) {
                if (setHdr) {
                    req.headers['x-parsoid-variant'] = invert(variant);
                }
                return this.mods[invert(variant)][operation](hyper, req)
                .then((res) => {
                    res.headers = res.headers || {};
                    res.headers['x-parsoid-variant'] = invert(variant);
                    return P.resolve(res);
                });
            }
            throw e;
        });
    }

    doRequest(operation, hyper, req) {
        // TEMP: All linter and html2html requests go only to JS
        if (/Lint/.test(operation) || operation === 'transformHtmlToHtml') {
            return this._req('js', operation, hyper, req, false, true);
        }
        // END TEMP
        let variant = this._getStickyVariant(hyper, req);
        // TEMP: Do not honour the header or cookie for now
        /*if (variant) {
            // the variant has been set explicitly by the client, honour it
            return this._req(variant, operation, hyper, req, true, true);
        }*/
        // END TEMP
        // we can safely check simply where to direct the request
        // using splitRegex because it won't match anything for any
        // mode other than split
        if (this.splitRegex.test(req.params.domain)) {
            variant = invert(this.default_variant);
        } else {
            variant = this.default_variant;
        }
        // mirror mode works only for getFormat, since for mirroring
        // tranforms we would need to be sure we have the php output
        // stashed
        // also, if we are in split mode, then we must pretend we are
        // also in 100% mirror mode since we want to keep both
        // variants in storage fresh
        if (this.mode !== 'single' && !/transform/.test(operation)) {
            if (Math.round(Math.random() * 100) <= this.percentage) {
                // clone the request and its headers
                const mReq = {
                    method: req.method,
                    uri: req.uri,
                    headers: Object.assign({}, req.headers),
                    query: req.query,
                    body: req.body,
                    params: req.params
                };
                // issue an async request to the second variant and
                // don't wait for the return value
                this._req(invert(variant), operation, hyper, mReq, false)
                .catch((e) => hyper.logger.log(`info/parsoidproxy/${invert(variant)}`, e));
            }
        }

        return this._req(variant, operation, hyper, req);
    }

    getOperations() {
        const ret = {};
        OPERATIONS.forEach((o) => {
            ret[o] = this.doRequest.bind(this, o);
        });
        return ret;
    }

}

module.exports = (options = {}) => {
    const ps = new ParsoidProxy(options);
    return {
        spec,
        operations: ps.getOperations(),
        resources: ps.resources
    };
};
