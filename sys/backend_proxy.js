'use strict';

const P = require('bluebird');
const HyperSwitch = require('hyperswitch');

const Template = HyperSwitch.Template;
const HTTPError = HyperSwitch.HTTPError;

module.exports = (options) => {
    options = options || {};
    options.backend_host_template = options.backend_host_template || '/{domain}/sys';
    if (!Object.prototype.hasOwnProperty.call(options, 'use_path_segment')) {
        options.use_path_segment = true;
    }
    if (!Object.prototype.hasOwnProperty.call(options, 'block_external_reqs')) {
        options.block_external_reqs = true;
    }
    const backendURITemplate = new Template({
        uri: `${options.backend_host_template}/{{path}}`
    });
    const usePathSegment = options.use_path_segment;
    const blockExternalReqs = options.block_external_reqs;
    return {
        spec: {
            paths: {
                '/{+path}': {
                    all: {
                        operationId: 'proxy',
                        'x-monitor': false
                    }
                }
            }
        },
        operations: {
            proxy: (hyper, req) => {
                if (blockExternalReqs && !hyper._isSysRequest(req) &&
                        req.headers['x-request-class'] === 'external') {
                    return P.reject(new HTTPError({
                        status: 403,
                        body: {
                            type: 'forbidden',
                            title: 'Forbidden',
                            description: 'You are not allowed to access this URI'
                        }
                    }));
                }
                if (usePathSegment) {
                    // if usePathSegment is set (true by default), then the proxy module
                    // will include the path segment preceding the specified path to
                    // construct the full request URI
                    const uri = req.uri.toString();
                    const uriPrefix = uri.substring(0, uri.indexOf(`/${req.params.path}`));
                    const segment = uriPrefix.split('/').pop();
                    req.params.path = `${segment}/${req.params.path}`;
                }
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
