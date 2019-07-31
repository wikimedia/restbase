'use strict';

const P = require('bluebird');
const HyperSwitch = require('hyperswitch');
const URI = HyperSwitch.URI;
const HTTPError = HyperSwitch.HTTPError;
const mwUtil = require('../lib/mwUtil');

const FORMATS = ['mml', 'svg', 'png'];

function prefixHeaders(headers, prefix = 'x-store-') {
    const prefixedHeaders = {};
    Object.keys(headers).forEach((header) => {
        prefixedHeaders[`${prefix}${header}`] = headers[header];
    });
    return prefixedHeaders;
}

class MathoidService {
    constructor(options) {
        this.options = options;
    }

    checkInput(hyper, req) {
        const rp = req.params;
        let hash;
        let origHash;
        let checkRes;

        // start by calculating the hash
        return hyper.post({
            uri: new URI([rp.domain, 'sys', 'post_data', 'mathoid_ng.input', 'hash']),
            body: { q: req.body.q, type: rp.type }
        }).then((res) => {
            hash = origHash = res.body;
            // short-circuit if it's a no-cache request
            if (mwUtil.isNoCacheRequest(req)) {
                return P.reject(new HTTPError({ status: 404 }));
            }
            // check the post storage
            return hyper.get({
                uri: new URI([rp.domain, 'sys', 'key_value', 'mathoid_ng.check', hash])
            }).catch({ status: 404 }, () => // let's try to find an indirection
                hyper.get({
                    uri: new URI([rp.domain, 'sys', 'key_value', 'mathoid_ng.hash_table', hash])
                }).then((hashRes) => {
                    // we have a normalised version of the formula
                    hash = hashRes.body;
                    // grab that version from storage
                    return hyper.get({
                        uri: new URI([rp.domain, 'sys', 'key_value', 'mathoid_ng.check', hash])
                    });
                }));
        }).catch({ status: 404 }, () => // if we are here, it means this is a new input formula
        // so call mathoid
            hyper.post({
                uri: `${this.options.host}/texvcinfo`,
                headers: { 'content-type': 'application/json' },
                body: {
                    q: req.body.q,
                    type: rp.type
                }
            }).then((res) => {
                checkRes = res;
                // store the normalised version
                return hyper.put({
                    uri: new URI([rp.domain, 'sys', 'post_data', 'mathoid_ng.input', '']),
                    headers: {
                        'content-type': 'application/json',
                        'x-store-content-type': 'application/json'
                    },
                    body: {
                        q: res.body.checked,
                        type: rp.type
                    }
                });
            }).then((res) => {
                let indirectionP = P.resolve();
                hash = res.body;
                // add the indirection to the hash table if the hashes don't match
                if (hash !== origHash) {
                    indirectionP = hyper.put({
                        uri: new URI([rp.domain, 'sys', 'key_value', 'mathoid_ng.hash_table',
                            origHash]),
                        headers: {
                            'content-type': 'text/plain',
                            'x-store-content-type': 'text/plain'
                        },
                        body: hash
                    });
                }
                // store the result
                checkRes.headers = {
                    'content-type': 'application/json',
                    'cache-control': 'no-cache',
                    'x-resource-location': hash
                };
                return P.join(
                    hyper.put({
                        uri: new URI([rp.domain, 'sys', 'key_value', 'mathoid_ng.check', hash]),
                        headers: Object.assign({
                            'content-type': 'application/json'
                        }, prefixHeaders(checkRes.headers)),
                        body: checkRes.body
                    }),
                    indirectionP,
                    this._invalidateCache.bind(this, hyper, hash),
                    () => checkRes
                );
            }));

    }

    _storeRenders(hyper, domain, hash, completeBody) {
        let idx;
        const len = FORMATS.length;
        const reqs = new Array(len);

        for (idx = 0; idx < len; idx++) {
            const format = FORMATS[idx];
            // ensure that we have a proper response for a given format
            if (!completeBody[format] ||
                    !completeBody[format].headers ||
                    !completeBody[format].body) {
                return P.reject(new HTTPError({
                    status: 500,
                    body: {
                        type: 'server_error#empty_response',
                        description: `Math: missing or malformed response for format ${format}`
                    }
                }));
            }
            // construct the request object that will be emitted
            Object.assign(completeBody[format].headers, {
                'x-resource-location': hash
            });
            const reqObj = {
                uri: new URI([domain, 'sys', 'key_value', `mathoid_ng.${format}`, hash]),
                headers: Object.assign({
                    'content-type': completeBody[format].headers['content-type']
                }, prefixHeaders(completeBody[format].headers)),
                body: completeBody[format].body
            };
            if (format === 'png' && reqObj.body && reqObj.body.type === 'Buffer') {
                // for png, we need to convert the encoded data manually
                // because we are receiving it wrapped inside a JSON
                reqObj.body = Buffer.from(reqObj.body.data);
                completeBody[format].body = reqObj.body;
            }
            // store the emit Promise
            reqs[idx] = hyper.put(reqObj);
        }

        // invalidate the cache
        reqs.push(this._invalidateCache(hyper, hash));

        // now do them all
        return P.all(reqs).then(() => completeBody);

    }

    requestAndStore(hyper, req) {
        const rp = req.params;
        const hash = req.headers['x-resource-location'];

        // first ask for all the renders from Mathoid
        return hyper.post({
            uri: `${this.options.host}/complete`,
            headers: { 'content-type': 'application/json' },
            body: req.body
        }).then((res) => // now store all of the renders
            this._storeRenders(hyper, rp.domain, hash, res.body)).then((res) => {
            // and return a proper response
            const ret = res[rp.format];
            ret.status = 200;
            Object.assign(ret.headers, { 'cache-control': this.options['cache-control'] });
            return ret;
        });

    }

    _invalidateCache(hyper, hash) {

        const routes = [];
        const uri = '//wikimedia.org/api/rest_v1/media/math/';

        routes.push(`${uri}formula/${hash}`);

        FORMATS.forEach((fmt) => {
            routes.push(`${uri}render/${fmt}/${hash}`);
        });

        return hyper.post({
            uri: new URI(['wikimedia.org', 'sys', 'events', '']),
            body: routes.map((route) => ({
                meta: { uri: route }
            }))
        }).catch((e) => {
            hyper.logger.log('warn/bg-updates', e);
        });

    }

    getFormula(hyper, req) {
        const rp = req.params;
        let hash = rp.hash;
        return hyper.get({
            uri: new URI([rp.domain, 'sys', 'post_data', 'mathoid_ng.input', hash])
        }).then((res) => {
            res.headers['x-resource-location'] = hash;
            return res;
        }).catch({ status: 404 }, () => // let's try to find an indirection
            hyper.get({
                uri: new URI([rp.domain, 'sys', 'key_value', 'mathoid_ng.hash_table', hash])
            }).then((hashRes) => {
                // we have a normalised version of the formula
                hash = hashRes.body;
                // grab that version from storage
                return hyper.get({
                    uri: new URI([rp.domain, 'sys', 'post_data', 'mathoid_ng.input', hash])
                }).then((res) => {
                    res.headers['x-resource-location'] = hash;
                    return res;
                });
            }));
    }
}

module.exports = (options) => {

    const mathoidSrv = new MathoidService(options);

    return {
        spec: {
            paths: {
                '/formula/{hash}': {
                    get: {
                        operationId: 'getFormula'
                    }
                },
                '/check/{type}': {
                    post: {
                        operationId: 'checkInput'
                    }
                },
                '/render/{format}': {
                    post: {
                        operationId: 'requestAndStore'
                    }
                }
            }
        },
        operations: {
            getFormula: mathoidSrv.getFormula.bind(mathoidSrv),
            checkInput: mathoidSrv.checkInput.bind(mathoidSrv),
            requestAndStore: mathoidSrv.requestAndStore.bind(mathoidSrv)
        },
        resources: [
            {
                uri: '/{domain}/sys/post_data/mathoid_ng.input'
            },
            {
                uri: '/{domain}/sys/key_value/mathoid_ng.hash_table',
                headers: {
                    'content-type': 'application/json'
                },
                body: { valueType: 'string' }
            },
            {
                uri: '/{domain}/sys/key_value/mathoid_ng.check',
                headers: {
                    'content-type': 'application/json'
                },
                body: { valueType: 'json' }
            }, {
                uri: '/{domain}/sys/key_value/mathoid_ng.svg',
                headers: {
                    'content-type': 'application/json'
                },
                body: {
                    keyType: 'string',
                    valueType: 'string'
                }
            }, {
                uri: '/{domain}/sys/key_value/mathoid_ng.mml',
                headers: {
                    'content-type': 'application/json'
                },
                body: {
                    keyType: 'string',
                    valueType: 'string'
                }
            }, {
                uri: '/{domain}/sys/key_value/mathoid_ng.png',
                headers: {
                    'content-type': 'application/json'
                },
                body: {
                    keyType: 'string',
                    valueType: 'blob'
                }
            }
        ]
    };

};
