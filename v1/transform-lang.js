'use strict';

const HyperSwitch = require('hyperswitch');
const mwUtil = require('../lib/mwUtil');

const spec = HyperSwitch.utils.loadSpec(`${__dirname}/transform-lang.yaml`);

class TransformLang {
    constructor(options) {
        this._options = options;
        if (!this._options.cx_host) {
            throw new Error('transform-lang.js: option cx_host not present!');
        }
    }

    doMT(hyper, req) {
        const rp = req.params;
        return mwUtil.getSiteInfo(hyper, req).get('general').get('lang').then((lang) => {
            let uri = `${this._options.cx_host}/v1/mt/${rp.from}/${lang}`;
            if (rp.provider) {
                uri += `/${rp.provider}`;
            }
            return hyper.post({
                uri,
                body: req.body
            });
        });
    }

    doDict(hyper, req) {
        const rp = req.params;
        return mwUtil.getSiteInfo(hyper, req).get('general').get('lang').then((lang) => {
            let uri = `${this._options.cx_host}/v1/dictionary/${encodeURIComponent(rp.word)}/` +
                `${rp.from}/${lang}`;
            if (rp.provider) {
                uri += `/${rp.provider}`;
            }
            return hyper.get({
                uri,
                body: req.body
            });
        });
    }

}

module.exports = (options) => {
    const transformLang = new TransformLang(options);
    return {
        spec,
        operations: {
            doMT: transformLang.doMT.bind(transformLang),
            doDict: transformLang.doDict.bind(transformLang)
        }
    };
};
