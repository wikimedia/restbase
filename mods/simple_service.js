'use strict';

/*
 * Simple service proxy & cache/storage module
 */

var P = require('bluebird');
var URI = require('swagger-router').URI;

// Store titles as MediaWiki db keys
function normalizeTitle (title) {
    return title.replace(/ /g, '_');
}

function SimpleService(options) {
    options = options || {};
    this.spec = {
        paths: options.paths
    };

    this.exports = this.processSpec(this.spec);
}

SimpleService.prototype.processSpec = function(spec) {
    var self = this;
    var operations = {};
    var resources = [];

    Object.keys(spec.paths).forEach(function(path) {
        var pathObj = spec.paths[path];
        Object.keys(pathObj).forEach(function(method) {
            var conf = pathObj[method];
            conf.operationId = method + '_' + path;
            var storageUriTemplate;
            if (conf.storage) {
                if (!conf.storage.bucket_request.uri) {
                    throw new Error('Broken config: expected storage.bucket_request.uri for ' + path);
                }
                storageUriTemplate = new URI('/{domain}/sys/key_value/'
                        + conf.storage.bucket_name + '/{key}{/tid}');
            }
            var backendUriTemplate = new URI(conf.backend_request.uri);
            operations[conf.operationId] = function(restbase, req) {
                var rp = req.params;
                if (rp.key) {
                    rp.key = normalizeTitle(rp.key);
                }

                function backendRequest() {
                    backendUriTemplate.params = req.params;
                    return restbase.request({
                        uri: backendUriTemplate.expand(),
                        // TODO: be selective / configurable about forwarding
                        headers: req.headers,
                        method: method,
                        body: req.body,
                    });
                }

                function regenerateAndSave() {
                    // Fall back to the backend service
                    return backendRequest()
                    .then(function(res) {
                        // TODO: store the result
                        return res;
                    });
                }

                if (conf.storage) {
                    if (conf.storage['no-cache_refresh']
                            && /\bno-cache\b/.test(req.headers['cache-control'])) {
                        return regenerateAndSave();
                    } else {
                        // Try storage first
                        storageUriTemplate.params = req.params;
                        return restbase.get({
                            uri: storageUriTemplate.expand()
                        })
                        .catch(function(e) {
                            if (e.status === 404) {
                                return regenerateAndSave();
                            } else {
                                throw e;
                            }
                        });
                    }
                } else {
                    // Only proxy, don't store anything
                    return backendRequest();
                }
            };
        });
    });

    return {
        spec: spec,
        operations: operations,
        resources: resources,
    };
};


module.exports = function (options) {
    return new SimpleService(options).exports;
};
