'use strict';

/*
 * Simple service proxy & cache/storage module
 */

var handlerTemplate = require('../lib/handlerTemplate');

function SimpleService(options) {
    options = options || {};
    this.spec = {
        paths: options.paths
    };

    this.exports = this.processSpec(this.spec);
}

/**
 * Processes the service spec and prepares the service to work.
 *
 * @param spec spec object parsed from yaml config
 *
 * @returns {{spec: Object, operations: Object, resources: Array}}
 *          spec: modified spec object with generated operation ids
 *          operations: map with request handlers
 *          resources: array of request templates that should be run on service startup
 */
SimpleService.prototype.processSpec = function(spec) {
    var operations = [];
    var resources = [];

    Object.keys(spec.paths).forEach(function(path) {
        var pathObj = spec.paths[path];
        Object.keys(pathObj).forEach(function(method) {
            var conf = pathObj[method];
            if (conf['x-setup-handler']) {
                resources = resources.concat(
                    handlerTemplate.parseSetupConfig(conf['x-setup-handler']));
            }
            operations[method + '_' + path] =
                handlerTemplate.createHandler(conf['x-request-handler']);
        });
    });

    return {
        spec: spec,
        operations: operations,
        resources: resources
    };
};


module.exports = function(options) {
    return new SimpleService(options).exports;
};