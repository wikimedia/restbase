'use strict';

const HyperSwitch = require('hyperswitch');
const Template = HyperSwitch.Template;

module.exports = (options) => {
    options = options || {};
    options.backend_host_template = options.backend_host_template || '/{domain}/sys/legacy';
    const backendURITemplate = new Template({
        uri: `${options.backend_host_template}/{{path}}`
    });
    return {
        spec: {
            paths: {
                '/{+path}': {
                    'x-route-filters': options.block_external_reqs ?
                        [{
                            type: 'default',
                            name: 'header_match',
                            options: {
                                whitelist: {
                                    'x-client-ip': ['/^(?:::1)|(?:::ffff:)?(?:10|127)\\./']
                                }
                            }
                        }] : [],
                    all: {
                        operationId: 'proxy',
                        'x-monitor': false,
                        'x-hidden': true
                    }
                }
            }
        },
        operations: {
            proxy: (hyper, req) => {
                const uri = req.uri.toString();
                const uriPrefix = uri.substring(0, uri.indexOf(`/${req.params.path}`));
                const segment = uriPrefix.split('/').pop();
                req.params.path = `${segment}/${req.params.path}`;
                return hyper.request({
                    method: req.method,
                    uri: backendURITemplate.expand({ request: req }).uri,
                    headers: req.headers,
                    body: req.body,
                    query: req.query
                })
                .then((res) => {
                    // We are slowly switching to storing data as binary blobs
                    // in the storage component. When running multi-process,
                    // the storage component will return the appropriate
                    // content-type and deserializing the response will
                    // happen internally in preq. However, when running
                    // single process, preq is not involved, so for consistency
                    // we need to manually deserialize the returned blob.
                    if (res &&
                            res.headers &&
                            res.headers['content-type'] &&
                            res.headers['content-type'].startsWith('application/json') &&
                            Buffer.isBuffer(res.body)) {
                        res.body = JSON.parse(res.body.toString('utf8'));
                    }
                    return res;
                });
            }
        }
    };
};
