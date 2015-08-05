'use strict';

/*
 * Simple service proxy & cache/storage module
 */

var P = require('bluebird');
var URI = require('swagger-router').URI;
var rbUtil = require('../lib/rbUtil');
var Template = require('../lib/reqTemplate');


function SimpleService(options) {
    options = options || {};
    this.spec = {
        paths: options.paths
    };

    this.exports = this.processSpec(this.spec);
}

function processResources(conf) {
    var resources = [];
    if (conf.on_setup) {
        if (Array.isArray(conf.on_setup)) {
            conf.on_setup.forEach(function(resourceSpec) {
                Object.keys(resourceSpec).forEach(function(requestName) {
                    var requestSpec = resourceSpec[requestName];
                    requestSpec.method = requestSpec.method || 'put';
                    resources.push(new Template(requestSpec));
                });
            });
        } else {
            throw new Error('Invalid config. on_setup must be an array');
        }
    }
    return resources;
}

function compileCatchFunction(catchDefinition) {
    var condition = [];
    var code;
    Object.keys(catchDefinition).forEach(function(catchCond) {
        if (Array.isArray(catchDefinition[catchCond])) {
            var orCondition = [];
            catchDefinition[catchCond].forEach(function(option) {
                if (catchCond === 'status') {
                    if (/^[0-9]+$/.test(option.toString())) {
                        orCondition.push('(res"[' + catchCond + '"] === ' + option + ')');
                    } else {
                        orCondition.push('(/^' + option.replace('x', '.') + '$/.test(res["' + catchCond + '"].toString())');
                    }
                } else {
                    orCondition.push('(res["' + catchCond + '"] === ' + option + ')');
                }
                condition.push('(' + orCondition.join(' || ') + ')');
            });
        } else {
            condition.push('(res["' + catchCond + '"] === ' + catchDefinition[catchCond] + ')');
        }
    });
    code =  'if (' + condition.join(' && ') + ') { return true; } else { return false; }';
    /* jslint evil: true */
    return new Function('res', code);
}

function isReturnStep(stepConf) {
    return Object.keys(stepConf).some(function(requestName) {
        return stepConf[requestName].return || stepConf[requestName].return_if;
    });
}

function validateStep(stepConf) {
    if (isReturnStep(stepConf) && Object.keys(stepConf).length > 1) {
        throw new Error('Invalid spec. ' +
            'Returning requests cannot be parallel. Spec: ' + JSON.stringify(stepConf));
    }
    if (! Object.keys(stepConf).any)
}

function validateSpec(spec) {
    if (!spec.paths) {
        throw new Error('Invalid spec. Paths are required. Spec: ' + JSON.stringify(spec));
    }
    Object.keys(spec.paths).forEach(function(path) {
        var conf = spec.paths[path];
        if (!conf.on_request || !Array.isArray(conf.on_request)) {
            throw new Error('Invalid spec. on_request part is required and must be an array');
        }
        conf.on_request.forEach(validateStep);
    });
}

SimpleService.prototype.processSpec = function(spec) {
    var self = this;
    var operations = [];
    var resources = [];

    Object.keys(spec.paths).forEach(function(path) {
        var pathObj = spec.paths[path];
        Object.keys(pathObj).forEach(function(method) {
            var conf = pathObj[method];
            var requestChain = [];

            conf.operationId = method + '_' + path;
<<<<<<< HEAD
            var storageUriTemplate;
            if (conf.storage) {
                if (!conf.storage.bucket_request.uri) {
                    throw new Error('Broken config: expected storage.bucket_request.uri for ' + path);
                }
                storageUriTemplate = new URI(conf.storage.item_request.uri, {}, true);
                resources.push(conf.storage.bucket_request);
            }
=======

            resources = resources.concat(processResources(conf));
>>>>>>> Fixed test config

            conf.on_request.forEach(function(stepConf) {
                var operation = [];
                var template;
                Object.keys(stepConf).forEach(function(requestName) {
                    var requestConf = stepConf[requestName];
                    var requestSpec = {
                        name: requestName
                    };
                    if (requestConf.request) {
                        template = new Template(requestConf.request);
                        requestSpec.request = function(restbase, context) {
                            var req = template.eval(context);
                            return restbase.request(req)
                            .then(function(res) {
                                context[requestName] = res;
                                return res;
                            });
                        };
                    }
                    if (requestConf.return) {
                        (function() {
                            var template = new Template(requestConf.return);
                            requestSpec.return = function(context) {
                                return function() {
                                    return template.eval(context);
                                };
                            };
                        })();
                    }
                    if (requestConf.return_if) {
                        requestSpec.return_if = compileCatchFunction(requestConf.return_if);
                    }
                    if (requestConf.catch) {
                        requestSpec.catch = compileCatchFunction(requestConf.catch);
                    }
                    operation.push(requestSpec);
                });
                requestChain.push(operation);
            });

            function generatePromiseChain(restbase, context, requestChain) {
                var promise;
                var currentRequestSpec = requestChain[0];
                if (currentRequestSpec.length > 1) {
                    promise = P.all(currentRequestSpec.map(function(spec) {
                        return spec.request(restbase, context);
                    }));
                } else {
                    if (currentRequestSpec[0].request) {
                        promise = currentRequestSpec[0].request(restbase, context);
                    }
                }

                function backendRequest() {
                    return restbase.request(backendRequestTemplate.eval({request:req}));
                }

                if (currentRequestSpec[0].catch) {
                    promise = promise.catch(function(err) {
                        if (!currentRequestSpec[0].catch(err)) {
                            throw err;
                        }
                    });
                }
                promise = promise || P.resolve();
                if (requestChain.length === 1) {
                    return promise;
                } else if (currentRequestSpec[0].return_if) {
                    return promise.then(function(res) {
                        if (res && currentRequestSpec[0].return_if(res)) {
                            return res;
                        } else {
                            return generatePromiseChain(restbase, context, requestChain.slice(1));
                        }
                    });
                } else {
                    return promise.then(function() {
                        return generatePromiseChain(restbase, context, requestChain.slice(1));
                    });
                }
            }
            operations[conf.operationId] = function(restbase, req) {
                var context = {
                    request: req
                };
                return generatePromiseChain(restbase, context, requestChain);
            };
        });
    });

    return {
        spec: spec,
        operations: operations,
        resources: resources
    };
};


module.exports = function (options) {
    return new SimpleService(options).exports;
};
