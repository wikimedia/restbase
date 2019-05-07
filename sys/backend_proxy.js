'use strict';

const Template = require('hyperswitch').Template;

module.exports = (options) => {
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
                req.uri = backendURITemplate.expand({ request: req }).uri.toString();
                return hyper.request({
                    method: req.method,
                    uri: backendURITemplate.expand({ request: req }).uri.toString(),
                    headers: req.headers,
                    body: req.body,
                    query: req.query
                });
            }
        }
    };
};
