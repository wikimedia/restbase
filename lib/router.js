"use strict";

require('es6-collections');

var yaml = require('js-yaml');
// TODO: promisify & use async loading
var fs = require('fs');
var util = require('util');

var swagger_router = require('swagger-router');
var Node = swagger_router.Node;
var URI = swagger_router.URI;

function RBRouteTreeBuilder (options) {
    this._options = options;
    this._nodes = new Map();
    this._modules = new Map();
}

RBRouteTreeBuilder.prototype._loadSpec = function(path) {
    if (path instanceof Object) {
        // Inline sub-spec: return directly
        return path;
    }
    // XXX: make the spec path configurable?
    var fsPath = 'interfaces/' + path + '.yaml';
    // Let errors bubble up for now. Fail loud & early.
    return yaml.safeLoad(fs.readFileSync(fsPath));
};

// Extend an existing route tree with a new path by walking the existing tree
// and inserting new subtrees at the desired location.
RBRouteTreeBuilder.prototype._buildPath = function route(node, path) {
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

// handle one spec path
RBRouteTreeBuilder.prototype._handleRESTBasePathSpec = function(node, subspec, symbols) {
    var self = this;
    var xrb = subspec['x-restbase'];
    if (xrb) {
        symbols = symbols || {};
        // modules
        if (Array.isArray(xrb.modules)) {
            // load each module
            xrb.modules.forEach(function(m) {
                // Share modules
                var mObj = self._modules.get(m);
                if (!mObj) {
                    //mObj = require(/* somepath + */ m.name)(m.options);
                    mObj = {};
                    self._modules.set(m, mObj);
                }

                for (var symbol in mObj) {
                    // check for duplicate symbols
                    if (symbols[symbol]) {
                        throw new Error("Duplicate symbol " + symbol
                                + " in module " + m.name);
                    } else {
                        symbols[symbol] = mObj[symbol];
                    }
                }
            });
        }

        // interfaces
        if (Array.isArray(xrb.interfaces)) {
            xrb.interfaces.forEach(function(subSpecPath) {
                var subSpec = self._loadSpec(subSpecPath);
                return self._handleRESTBaseSpec(node, subSpec, symbols);
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
        if (mxrb) {
            // check for 'handler' in symbols
            if (mxrb.handler) {
                var handler = symbols[mxrb.handler];
                if (handler) {
                    node.value.methods[methodName] = handler;
                }
            } else if (mxrb.service) {
                // set up a handler
                // XXX: share?
                node.value.methods[methodName] = function (restbase, req) {
                    // XXX: expand the request with req information!
                    restbase.request(mxrb.service);
                };
            }
        }
    }
};

RBRouteTreeBuilder.prototype._handleRESTBaseSpec = function (rootNode, spec, modules) {
    var self = this;
    function handlePaths (paths) {
        // handle paths
        for (var pathPattern in paths) {
            var pathSpec = paths[pathPattern];
            var path = new URI(pathPattern).segments;
            // Expected to return
            // - rootNode for single-element path
            // - a subnode for longer paths
            var branchNode = self._buildPath(rootNode, path.slice(0, path.length - 1));
            // Check if we can share the path spec
            var subtree = self._nodes.get(pathSpec);
            if (!subtree) {
                console.log('not shared:', pathPattern);
                // Build a new tree
                subtree = new Node();
                // Set up our specific value object
                subtree.value = {
                    methods: {}
                };
                // Assign the node before building the tree, so that sharing
                // opportunities with the same spec are discovered while doing so
                self._nodes.set(pathSpec, subtree);
                self._handleRESTBasePathSpec(subtree, pathSpec, modules);
            } else {
                console.log('shared:', pathPattern);
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
    if (spec['x-restbase-paths']) {
        // TODO:
        // - bail out if prefix is not '/{domain}/sys/'
        // - set up path-based ACLs to disallow direct access
        handlePaths(spec['x-restbase-paths']);
    }

    if (spec.paths) {
        handlePaths(spec.paths);
    }
};

RBRouteTreeBuilder.prototype.buildTree = function(spec) {
    var rootNode = new Node();
    this._handleRESTBaseSpec(rootNode, spec, {});
    return rootNode;
};

module.exports = RBRouteTreeBuilder;
