"use strict";

require('es6-collections');

var yaml = require('js-yaml');
// TODO: promisify & use async loading
var fs = require('fs');
var util = require('util');

var swaggerRouter = require('swagger-router');
var Node = swaggerRouter.Node;
var URI = swaggerRouter.URI;
var SwaggerRouter = swaggerRouter.Router;

function Router (options) {
    this._options = options;
    this._nodes = new Map();
    this._modules = new Map();
    this.router = new SwaggerRouter();
}

Router.prototype._readSpec = function(path) {
    // XXX: make the spec path configurable?
    var fsPath = __dirname + '/../specs/' + path + '.yaml';
    // Let errors bubble up for now. Fail loud & early.
    return yaml.safeLoad(fs.readFileSync(fsPath));
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
    var modObj = require(loadPath)(modDef.options);
    this._modules.set(modDef, modObj);
    Object.keys(modObj).forEach(function(symbol) {
        // check for duplicate symbols
        if (symbols[symbol]) {
            throw new Error("Duplicate symbol " + symbol + " in module " + modDef.name);
        } else {
            symbols[symbol] = modObj[symbol];
        }
    });
    return true;
};

// handle one spec path
Router.prototype._handleRESTBasePathSpec = function(node, subspec, symbols, uri) {
    var self = this;
    var xrb = subspec['x-restbase'];
    if (xrb) {
        symbols = symbols || {};
        // modules
        if (Array.isArray(xrb.modules)) {
            // load each module
            xrb.modules.forEach(function(m) {
                // Share modules
                if (!self._modules.has(m)) {
                    self._loadModule(m, symbols);
                }
            });
        }

        // specs / interfaces
        if (Array.isArray(xrb.specs)) {
            xrb.specs.forEach(function(subSpecOrPath) {
                var subSpec;
                if (subSpecOrPath instanceof Object) {
                    // Inline sub-spec: return directly
                    subSpec = subSpecOrPath;
                } else {
                    subSpec = self._readSpec(subSpecOrPath);
                }
                return self._handleRESTBaseSpec(node, subSpec, symbols, uri);
            });
        }
    }

    for (var methodName in subspec) {
        if (methodName === 'x-restbase') {
            continue;
        }
        // Other methods
        var method = subspec[methodName];
        var mxrb = method['x-restbase'];
        if (mxrb && mxrb.service) {
            // set up a handler
            // XXX: share?
            node.value.methods[methodName] = function (restbase, req) {
                // XXX: expand the request with req information!
                restbase.request(mxrb.service);
            };
        } else if (method.operationId) {
            var handler = symbols[method.operationId];
            if (handler) {
                node.value.methods[methodName] = handler;
            } else {
                throw new Error('no known handler associated with operationId ' + method.operationId);
            }
        }
    }
};

Router.prototype._handleRESTBaseSpec = function (rootNode, spec, modules, uri) {
    var self = this;
    function handlePaths (paths) {
        // handle paths
        for (var pathPattern in paths) {
            var pathSpec = paths[pathPattern];
            var pathURI = new URI(pathPattern);
            var path = pathURI.segments;
            // Expected to return
            // - rootNode for single-element path
            // - a subnode for longer paths
            var branchNode = self._buildPath(rootNode, path.slice(0, path.length - 1));
            // Check if we can share the path spec
            var subtree = self._nodes.get(pathSpec);
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
                uri.pushSuffix(pathURI);
                self._handleRESTBasePathSpec(subtree, pathSpec, modules, uri);
                uri.popSuffix(pathURI);
            } else {
                //console.log('shared:', pathPattern);
                subtree = subtree.clone();
            }

            // XXX: Set ACLs and other value properties for path
            // subtree.value.acls = ...;

            // XXX: check for conflicts!
            branchNode.setChild(path[path.length - 1], subtree);
        }
    }

    // TODO: handle global spec settings

    // Handle internal paths
    if (spec && spec['x-restbase-paths']) {
        // TODO:
        // - set up path-based ACLs to disallow direct access
        // check for /{domain}/sys prefix
        for (var pathPattern in spec['x-restbase-paths']) {
            var checkURI = new URI(uri);
            checkURI.pushSuffix(pathPattern);
            if (!checkURI.startsWith('/{domain}/sys')) {
                throw new Error('x-restbase-paths can live exclusively inside the /{domain}/sys path!');
            }
        }
        handlePaths(spec['x-restbase-paths']);
    }

    if (spec && spec.paths) {
        handlePaths(spec.paths);
    }
};

Router.prototype.loadSpec = function(spec) {
    var rootNode = new Node();
    if (spec && spec.constructor === String) {
        spec = this._readSpec(spec);
    }
    this._handleRESTBaseSpec(rootNode, spec, {}, new URI());
    this.tree = rootNode;
    this.router.setTree(rootNode);
};

Router.prototype.route = function (uri) {
    return this.router.lookup(uri);
};

module.exports = Router;
