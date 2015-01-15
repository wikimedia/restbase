"use strict";

require('es6-collections');

var yaml = require('js-yaml');
var fs = Promise.promisifyAll(require('fs'));
var util = require('util');

var swaggerRouter = require('swagger-router');
var Node = swaggerRouter.Node;
var URI = swaggerRouter.URI;
var SwaggerRouter = swaggerRouter.Router;
var request_parser = require('./proxyHandler');

function Router (options) {
    this._options = options || {};
    this._nodes = new Map();
    this._modules = new Map();
    this.router = new SwaggerRouter();
}

Router.prototype._readSpec = function(path) {
    // XXX: make the spec path configurable?
    var fsPath = __dirname + '/../specs/' + path + '.yaml';
    // Let errors bubble up for now. Fail loud & early.
    return fs.readFileAsync(fsPath)
    .then(function(yamlString) {
        return yaml.safeLoad(yamlString);
    });
};

// Extend an existing route tree with a new path by walking the existing tree
// and inserting new subtrees at the desired location.
Router.prototype._buildPath = function route(node, path) {
    var params = {};
    for (var i = 0; i < path.length; i++) {
        var nextNode = node.getChild(path[i], params);
        if (!nextNode) {
            nextNode = new Node();
            node.setChild(path[i], nextNode);
            node = nextNode;
        } else {
            node = nextNode;
        }
    }
    return node;
};

Router.prototype._loadModule = function (modDef, symbols) {
    var self = this;
    var loadPath;
    // determine the module's load path
    switch (modDef.type) {
        case 'file':
            if (modDef.path && /^\//.test(modDef.path)) {
                // absolute path
                loadPath = modDef.path;
            } else {
                // relative path or missing
                loadPath = __dirname + '/../mods/';
                if (modDef.path) {
                    // the path has been provided, use it
                    loadPath += modDef.path;
                } else {
                    // no path given, so assume the file
                    // name matches the module name
                    loadPath += modDef.name;
                }
            }
            break;
        case 'npm':
            loadPath = modDef.name;
            break;
        default:
            throw new Error('unknown module type ' + modDef.type + ' (for module ' + modDef.name + ').');
    }
    // append the log property to module options, if it is not present
    if (modDef.options) {
        modDef.options.log = modDef.options.log || this._options.log;
    }
    // let the error propagate in case the module cannot be loaded
    var modObj = require(loadPath);
    if (!modObj) {
        modObj = Promise.reject("Loading module " + loadPath + " failed.");
    }
    // Call if it's a function
    if (modObj instanceof Function) {
        modObj = modObj(modDef.options);
    }
    if (!(modObj instanceof Promise)) {
        // wrap
        modObj = Promise.resolve(modObj);
    }
    return modObj.then(function(mod) {
        self._modules.set(modDef, mod);
        Object.keys(mod).forEach(function(symbol) {
            // check for duplicate symbols
            if (symbols[symbol]) {
                throw new Error("Duplicate symbol " + symbol + " in module " + modDef.name);
            } else {
                symbols[symbol] = mod[symbol];
            }
        });
    });
};

// handle one spec path
Router.prototype._handleRESTBasePathSpec = function(node, subspec, symbols, uri) {
    var self = this;
    var xrb = subspec['x-restbase'];
    var xParsoidPromise;
    if (xrb) {
        symbols = symbols || {};
        xParsoidPromise = Promise.all(
            // modules
            (xrb.modules || []).map(function(m) {
                // load each module
                // Share modules
                if (!self._modules.has(m)) {
                    return self._loadModule(m, symbols);
                } else {
                    // nothing to do
                    return Promise.resolve();
                }
            })
        )
        .then(function() {
            // specs / interfaces
            if (Array.isArray(xrb.specs)) {
                return Promise.all(
                    xrb.specs.map(function(subSpecOrPath) {
                        var subSpecPromise;
                        if (subSpecOrPath instanceof Object) {
                            // Inline sub-spec: return directly
                            subSpecPromise = Promise.resolve(subSpecOrPath);
                        } else {
                            subSpecPromise = self._readSpec(subSpecOrPath);
                        }
                        return subSpecPromise
                        .then(function(subSpec) {
                            return self._handleRESTBaseSpec(node, subSpec, symbols, uri);
                        });
                    })
                );
            }
        });
    } else {
        // nothing to do
        xParsoidPromise = Promise.resolve();
    }

    return xParsoidPromise
    .then(function() {
        Object.keys(subspec).forEach(function(methodName) {
            if (methodName === 'x-restbase') {
                return;
            }
            // Other methods
            var method = subspec[methodName];
            var mxrb = method['x-restbase'];
            if (mxrb && mxrb.service) {
                // set up a handler
                // XXX: share?
                var eval_req = new request_parser().eval_request;
                eval_req = eval_req(mxrb.service);
                node.value.methods[methodName] = function (restbase, req) {
                    return restbase.request(eval_req(req));
                };
            } else if (method.operationId) {
                var handler = symbols[method.operationId];
                if (handler) {
                    node.value.methods[methodName] = handler;
                } else {
                    throw new Error('no known handler associated with operationId ' + method.operationId);
                }
            }
        });
    });
};

Router.prototype._handleRESTBaseSpec = function (rootNode, spec, modules, uri) {
    var self = this;
    function handlePaths (paths) {
        // handle paths
        return Promise.all(Object.keys(paths).map(function(pathPattern) {
            var pathSpec = paths[pathPattern];
            var pathURI = new URI(pathPattern);
            var path = pathURI.segments;
            // Expected to return
            // - rootNode for single-element path
            // - a subnode for longer paths
            var branchNode = self._buildPath(rootNode, path.slice(0, path.length - 1));
            // Check if we can share the path spec
            var subtree = self._nodes.get(pathSpec);
            var specPromise;
            if (!subtree) {
                //console.log('not shared:', pathPattern);
                // Build a new tree
                subtree = new Node();
                // Set up our specific value object
                subtree.value = {
                    methods: {}
                };
                // Assign the node before building the tree, so that sharing
                // opportunities with the same spec are discovered while doing so
                self._nodes.set(pathSpec, subtree);

                // Keep track of the nesting level
                uri.pushSuffix(pathURI);
                // Handle the path spec
                specPromise = self._handleRESTBasePathSpec(subtree, pathSpec, modules, uri);
                uri.popSuffix(pathURI);
            } else {
                //console.log('shared:', pathPattern);
                subtree = subtree.clone();
                specPromise = Promise.resolve();
            }
            return specPromise
            .then(function() {

                // XXX: Set ACLs and other value properties for path
                // subtree.value.acls = ...;

                // XXX: check for conflicts!
                branchNode.setChild(path[path.length - 1], subtree);
            });
        }));
    }

    // TODO: handle global spec settings

    return handlePaths(spec.paths);
};

Router.prototype.loadSpec = function(spec) {
    var self = this;
    var rootNode = new Node();
    var specPromise;
    if (spec && spec.constructor === String) {
        specPromise = this._readSpec(spec);
    } else {
        specPromise = Promise.resolve(spec);
    }
    return specPromise
    .then(function(spec) {
        return self._handleRESTBaseSpec(rootNode, spec, {}, new URI());
    })
    .then(function() {
        // Only set the tree after loading everything
        self.tree = rootNode;
        self.router.setTree(rootNode);
    });
};

Router.prototype.route = function (uri) {
    return this.router.lookup(uri);
};

module.exports = Router;
