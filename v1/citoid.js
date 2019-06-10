'use strict';

const HyperSwitch = require('hyperswitch');
const P = require('bluebird');
const mwUtil = require('../lib/mwUtil');
const spec = HyperSwitch.utils.loadSpec(`${__dirname}/citoid.yaml`);

class Citoid {
    constructor(options) {
        this._options = options;
    }

    getCitation(hyper, req) {
        const rp = req.params;
        let acceptLanguagePromise;
        if (req.headers && req.headers['accept-language']) {
            acceptLanguagePromise = P.resolve(req.headers['accept-language']);
        } else {
            acceptLanguagePromise = mwUtil.getSiteInfo(hyper, req).get('general').get('lang');
        }
        return acceptLanguagePromise.then((acceptLanguage) => {
            let reqURI = `${this._options.host}/api?format=${rp.format}&` +
                `search=${encodeURIComponent(rp.query)}`;

            return hyper.get({
                uri: reqURI,
                headers: {
                    'accept-language': acceptLanguage
                }
            });
        });
    }
}

module.exports = (options) => {
    const citoid = new Citoid(options);
    return {
        spec,
        operations: {
            getCitation: citoid.getCitation.bind(citoid)
        }
    };
};
