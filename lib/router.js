"use strict";

require('es6-collections');

var yaml = require('js-yaml');
var fs = Promise.promisifyAll(require('fs'));
var util = require('util');

var swaggerRouter = require('swagger-router');
var Node = swaggerRouter.Node;
var URI = swaggerRouter.URI;
var SwaggerRouter = swaggerRouter.Router;

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
Router.prototype._buildPath = function route(node, path, value) {
    var params = {};
    for (var i = 0; i < path.length; i++) {
        var segment = path[i];
        var nextNode = node.getChild(segment, params);
        if (!nextNode) {
            nextNode = new Node();
            node.setChild(segment, nextNode);
            if (segment.modifier === '/') {
                // Set the value for each optional path segment ({/foo})
                node.value = value;
            }
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
    modDef.options = modDef.options || {};
    if (!modDef.options.log) {
        modDef.options.log = this._options.log || function() {};
    }
    // let the error propagate in case the module cannot be loaded
    var modObj = require(loadPath);
    if (!modObj) {
        return Promise.reject("Loading module " + loadPath + " failed.");
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
        //console.log(loadPath, mod);
        self._modules.set(modDef, mod);
        if (!mod.operations) {
            throw new Error('No operations exported by module ' + loadPath);
        }
        Object.keys(mod.operations).forEach(function(symbol) {
            // check for duplicate symbols
            if (symbols[symbol]) {
                throw new Error("Duplicate symbol " + symbol + " in module " + modDef.name);
            } else {
                symbols[symbol] = mod.operations[symbol];
            }
        });
        return mod;
    });
};

function makeRequestTemplate(spec) {
    var uriTemplate = new URI(spec.uri, {}, true);
    return function (restbase, req) {
        // FIXME:
        // - Efficiently template other request parts
        uriTemplate.params = req.params;
        return restbase.request({
            uri: uriTemplate.expand(),
            method: req.method,
            body: req.body,
            headers: req.headers,
            query: req.query
        });
    };
}

// handle one spec path
Router.prototype._handleRESTBasePathSpec = function(node, subspec, symbols, uri) {
    var self = this;
    if (!subspec) {
        return Promise.resolve();
    }
    var xrb = subspec['x-restbase'];
    var xRestbasePromise;
    if (xrb) {
        symbols = symbols || {};
        xRestbasePromise = Promise.all(
            // modules
            (xrb.modules || []).map(function(m) {
                // load each module
                // Share modules
                if (!self._modules.has(m)) {
                    return self._loadModule(m, symbols)
                    .then(function(module) {
                        //console.log(module);
                        if (module && module.resources) {
                            node.value.resources = (node.value.resources || [])
                                .concat(module.resources);
                        }
                        return module;
                    });
                }
            })
        )
        .then(function(modules) {
            var specs = [];
            modules.forEach(function(mod) {
                if (mod && mod.spec) {
                    specs.push(mod.spec);
                }
            });
            if (Array.isArray(xrb.specs)) {
                specs = specs.concat(xrb.specs);
            }
            //console.log(specs);
            // specs / interfaces
            return Promise.all(
                specs.map(function(subSpecOrPath) {
                    var subSpecPromise;
                    if (subSpecOrPath instanceof Object) {
                        // Inline sub-spec: return directly
                        subSpecPromise = Promise.resolve(subSpecOrPath);
                    } else {
                        subSpecPromise = self._readSpec(subSpecOrPath);
                    }
                    return subSpecPromise
                    .then(function(subSpec) {
                        return self._handleRESTBaseSpec(node, subSpec, symbols);
                    });
                })
            );
        });
    } else {
        // nothing to do
        xRestbasePromise = Promise.resolve();
    }

    return xRestbasePromise
    .then(function() {
        Object.keys(subspec).forEach(function(methodName) {
            if (methodName === 'x-restbase') {
                return;
            }
            // Other methods
            var method = subspec[methodName];
            var mxrb = method && method['x-restbase'];
            if (mxrb && mxrb.service) {
                //console.log(mxrb.service);
                // set up a handler
                var templatedReq = makeRequestTemplate(mxrb.service);
                node.value.methods[methodName] = function (restbase, req) {
                    //console.log('template', req);
                    return templatedReq(restbase, req);
                };
            } else if (method.operationId) {
                var handler = symbols[method.operationId];
                if (handler) {
                    node.value.methods[methodName] = handler;
                    //console.log(method.operationId, node.value);
                } else {
                    throw new Error('No known handler associated with operationId ' + method.operationId);
                }
            }
        });
    });
};

Router.prototype._handleRESTBaseSpec = function (rootNode, spec, modules) {
    var self = this;
    function handlePaths (paths) {
        if (!paths || !Object.keys(paths).length) {
            // no paths here, nothing to do
            return Promise.resolve();
        }
        // handle paths
        return Promise.all(Object.keys(paths).map(function(pathPattern) {
            var pathSpec = paths[pathPattern];
            var path = new URI(pathPattern, {}, true).path;

            // Create a value object early, so that _buildPath can set up a reference
            // to it for optional path segments.
            var value = {
                path: undefined,
                methods: {}
            };

            // Expected to return
            // - rootNode for single-element path
            // - a subnode for longer paths
            var branchNode = self._buildPath(rootNode, path.slice(0, path.length - 1), value);

            // Check if we can share the path spec
            var subtree = self._nodes.get(pathSpec);
            var specPromise;
            if (!subtree) {
                //console.log('not shared:', pathPattern);

                var segment = path[path.length - 1];

                // Check if the subtree already exists, which can happen when
                // specs are overlapping. We don't allow this for now to keep
                // specs easy to read & understand.
                subtree = branchNode.getChild(segment, {});
                if (subtree) {
                    throw new Error('Trying to re-define existing subtree ' + pathPattern);
                }

                // Build a new subtree
                subtree = new Node();
                // Set up our specific value object
                subtree.value = value;
                value.path = pathPattern;
                value.methods = {};
                // XXX: Set ACLs and other value properties for path
                // subtree.value.acls = ...;

                if (segment.modifier === '+') {
                    // Set up a recursive match and end the traversal
                    subtree.setChild(segment, subtree);
                    // Since this path segment is optional, the parent node
                    // has the same value.
                    branchNode.value = value;
                }

                // Assign the node before building the tree, so that sharing
                // opportunities with the same spec are discovered while doing so
                self._nodes.set(pathSpec, subtree);

                // Handle the path spec
                specPromise = self._handleRESTBasePathSpec(subtree, pathSpec, modules);
            } else {
                //console.log('shared:', pathPattern);
                subtree = subtree.clone();
                subtree.value = value;
                specPromise = Promise.resolve();
            }
            branchNode.setChild(path[path.length - 1], subtree);
            return specPromise;
        }));
    }

    // TODO: handle global spec settings

    return handlePaths(spec.paths || {});
};

Router.prototype.handleResources = function(restbase) {
    var self = this;
    return this.tree.visitAsync(function(value, path) {
        if (value && Array.isArray(value.resources)) {
            return Promise.resolve(value.resources)
            .each(function(req) {
                if (!req.uri) {
                    throw new Error("Missing resource URI in spec for "
                            + JSON.stringify(path));
                }
                req.uri = new URI(req.uri, {
                    domain: path[0]
                }, true).expand();
                req.method = req.method || 'put';
                //console.log(path, req);
                return restbase.request(req);
            });
        } else {
            return Promise.resolve();
        }
    });
};

Router.prototype.loadSpec = function(spec, restbase) {
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
        return self._handleRESTBaseSpec(rootNode, spec, {}, new URI([]));
    })
    .then(function() {
        // Only set the tree after loading everything
        self.tree = rootNode;
        console.log(JSON.stringify(rootNode, null, 2));
        self.router.setTree(rootNode);
        return self.handleResources(restbase);
    })
    .then(function() {
        return self;
    });
};

Router.prototype.route = function (uri) {
    return this.router.lookup(uri);
};

module.exports = Router;
