'use strict';

/*
 * Simple proxy to route requests to the client-requested
 * Parsoid variant (JS or PHP) during the transition
 * period. Parsoid/JS is being phased out and replaced by
 * Parsoid/PHP.
 */

const HyperSwitch = require('hyperswitch');
const URI = HyperSwitch.URI;
const mwUtil = require('../lib/mwUtil');
const VARIANT_HDR_NAME = 'x-parsoid-variant';

module.exports = () => {
    return {
        spec: {
            paths: {
                '/{+path}': {
                    all: {
                        operationId: 'proxy_parsoid_variant'
                    }
                }
            }
        },
        operations: {
            proxy_parsoid_variant: (hyper, req) => {
                const rootReqHeaders = hyper._rootReq.headers || {};
                rootReqHeaders[VARIANT_HDR_NAME] = rootReqHeaders[VARIANT_HDR_NAME] || 'JS';
                const isPhpVariant = /PHP/i.test(rootReqHeaders[VARIANT_HDR_NAME]);

                return hyper.request({
                    method: req.method,
                    uri: new URI(req.uri.toString().replace('/parsoid/',
                        isPhpVariant ? '/parsoidphp/' : '/parsoidjs/')),
                    headers: req.headers,
                    body: req.body,
                    query: req.query
                })
                .tap((res) => {
                    res.headers = res.headers || {};
                    res.headers[VARIANT_HDR_NAME] = rootReqHeaders[VARIANT_HDR_NAME];
                    mwUtil.addVaryHeader(res, VARIANT_HDR_NAME);
                });
            }
        }
    };
};
