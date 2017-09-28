"use strict";

const P = require('bluebird');
const HyperSwitch = require('hyperswitch');
const URI = HyperSwitch.URI;

const mwUtil = require('../lib/mwUtil');

const spec = HyperSwitch.utils.loadSpec(`${__dirname}/parsoid.yaml`);

class ParsoidProxy {
    constructor(options) {
        this.options = options || {};
        this.options.backends = this.options.backends || { default: 'old' };

        // Set up operations
        this.operations = {
            getPageBundle: this.pagebundle.bind(this),
            // Revision retrieval per format
            getWikitext: this.getFormat.bind(this, 'wikitext'),
            getHtml: this.getFormat.bind(this, 'html'),
            getDataParsoid: this.getFormat.bind(this, 'data-parsoid'),
            // Listings
            listWikitextRevisions: this.listRevisions.bind(this, 'wikitext'),
            listHtmlRevisions: this.listRevisions.bind(this, 'html'),
            listDataParsoidRevisions: this.listRevisions.bind(this, 'data-parsoid'),
            // Transforms
            transformHtmlToHtml: this.makeTransform('html', 'html'),
            transformHtmlToWikitext: this.makeTransform('html', 'wikitext'),
            transformWikitextToHtml: this.makeTransform('wikitext', 'html'),
            transformWikitextToLint: this.makeTransform('wikitext', 'lint'),
            transformChangesToWikitext: this.makeTransform('changes', 'wikitext')
        };
    }

    _chooseBackend(req) {
        return this.options.backends[req.params.domain] || this.options.backends.default;
    }

    _buildRequest(prefix, req, listing) {
        const rp = req.params;
        const path = [rp.domain, 'sys'].concat(prefix);
        if (rp.title) {
            path.push(rp.title);
            if (rp.revision) {
                path.push(rp.revision);
                if (rp.tid) {
                    path.push(rp.tid);
                }
            }
        }
        if (listing) {
            path.push('');
        }
        return {
            method: req.method,
            uri: new URI(path),
            query: req.query,
            headers: req.headers,
            body: req.body
        };
    }

    _createDoubleProcessingRequest(hyper, req, oldPath, newPath, listing) {
        const oldRequest = this._buildRequest(oldPath, req, listing);
        const newRequest = this._buildRequest(newPath, req, listing);

        const backend = this._chooseBackend(req);
        if (backend === 'old') {
            return hyper.request(oldRequest);
        }
        if (backend === 'new') {
            return hyper.request(newRequest);
        }
        if (backend === 'both') {
            return P.join(
                hyper.request(oldRequest)
                .catch((e) => {
                    hyper.log('error/parsoid', {
                        message: 'Error fetching old parsoid content',
                        error: e
                    });
                    throw e;
                }),
                hyper.request(newRequest)
                .catch((e) => {
                    hyper.log('error/parsoid', {
                        message: 'Error fetching new parsoid content',
                        error: e
                    });
                })
            )
            .then((results) => {
                const oldContent = results[0];
                const newContent = results[1];

                if (oldContent && newContent && mwUtil.isNoCacheRequest(req)) {
                    if (oldContent.body !== newContent.body) {
                        hyper.log('error/mobileapps', {
                            message: 'Content mismatch between old and new bucket',
                            old_etag: oldContent.headers.etag,
                            new_etag:  newContent.headers.etag
                        });
                    }
                }

                return oldContent;
            });
        }
        throw new Error(`Unrecognised parsoid backend ${backend}`);
    }

    pagebundle(hyper, req) {
        return this._createDoubleProcessingRequest(
            hyper,
            req,
            ['parsoid_old', 'pagebundle'],
            ['parsoid_new', 'pagebundle']
        );
    }

    getFormat(format, hyper, req) {
        return this._createDoubleProcessingRequest(
            hyper,
            req,
            ['parsoid_old', format],
            ['parsoid_new', format]
        );
    }

    listRevisions(format, hyper, req) {
        return this._createDoubleProcessingRequest(
            hyper,
            req,
            ['parsoid_old', format],
            ['parsoid_new', format],
            true
        );

    }

    makeTransform(from, to) {
        return (hyper, req) => this._createDoubleProcessingRequest(
            hyper,
            req,
            ['parsoid_old', 'transform', from, 'to', to],
            ['parsoid_new', 'transform', from, 'to', to]
        );

    }
}

module.exports = (options) => {
    options = options || {};
    const ps = new ParsoidProxy(options);

    return {
        spec,
        operations: ps.operations
    };
};
