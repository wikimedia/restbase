'use strict';

const Template = require('hyperswitch').Template;

module.exports = (options) => {
    options = options || {};
    options.backend_host_template = options.backend_host_template || '/{domain}/sys';
    const backendURITemplate = new Template({
        uri: `${options.backend_host_template}/{{path}}`
    });
    return {
        spec: {
            paths: {
                '/{+path}': {
                    all: {
                        operationId: 'proxy'
                    }
                }
            }
        },
        operations: {
            proxy: (hyper, req) => {
                // Add the proxied module name to the path.
                // The proxy is mounted at paths like `/sys/key_value`. Here
                // out of a request path we want to find out the name of the module
                // that is being proxied (key_value) from the example and add it
                // to the proxy target path.
                const modName = req.uri.path[req.uri.path.indexOf('sys') + 1];
                req.params.path = `${modName}/${req.params.path}`;
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
