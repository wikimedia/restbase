'use strict';

const HyperSwitch = require('hyperswitch');
const URI = HyperSwitch.URI;

class TransformService {
    constructor(options) {
        if (!options && !options.mobileapps_host) {
            throw new Error('mobileapps_host not specified for PCS transform configuration');
        }
        this._options = options;
    }

    transformWikitextToMobileHtml(hyper, req) {
        const rp = req.params;
        return hyper.post({
            uri: new URI(
                [rp.domain, 'sys', 'parsoid', 'transform', 'wikitext', 'to', 'html', rp.title]
            ),
            headers: {
                'accept-language': req.headers && req.headers['accept-language']
            },
            body: {
                wikitext: req.body.wikitext
            }
        })
        .then((res) => {
            return hyper.post({
                uri: new URI(`${this._options.mobileapps_host}/${rp.domain}` +
                    `/v1/transform/html/to/mobile-html/${rp.title}`),
                headers: {
                    'content-type': res.headers['content-type'],
                    'output-mode': req.headers['output-mode']
                },
                body: res.body
            })
            .tap((mobileRes) => {
                mobileRes.headers['content-language'] = res.headers['content-language'];
            });
        });
    }
}

module.exports = (options) => {
    const service = new TransformService(options);
    const spec = HyperSwitch.utils.loadSpec(`${__dirname}/transform.yaml`);
    return {
        spec,
        operations: {
            transformWikitextToMobileHtml: service.transformWikitextToMobileHtml.bind(service)
        }
    };
};
