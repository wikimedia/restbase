"use strict";

var P = require('bluebird');
var yaml = require('js-yaml');
var fs = P.promisifyAll(require('fs'));
var Template = require('./reqTemplate');
var rbUtil = require('./rbUtil');
var handlerTemplate = require('./handlerTemplate');

var swaggerRouter = require('swagger-router');
var Node = swaggerRouter.Node;
var URI = swaggerRouter.URI;
var SwaggerRouter = swaggerRouter.Router;

function Router(options) {
    this._options = options || {};
    this._nodes = new Map();
    this._modules = new Map();
    this.router = new SwaggerRouter();
}

// Load & parse a yaml spec from disk
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


/**
 * Load and initialize a module
 */
Router.prototype._loadModule = function(modDef) {
    var cachedModule = this._modules.get(modDef);
    if (cachedModule) {
        // Found a cached instance. Return it.
        return P.resolve(cachedModule);
    }

    var self = this;
    var loadPath;
    // Determine the module's load path
    switch (modDef.type) {
        case 'file':
            if (modDef.path && /^\//.test(modDef.path)) {
                // Absolute path
                loadPath = modDef.path;
            } else {
                // Relative path or missing
                loadPath = __dirname + '/../mods/';
                if (modDef.path) {
                    // The path has been provided, use it
                    loadPath += modDef.path;
                } else {
                    // No path given, so assume the file
                    // name matches the module name
                    loadPath += modDef.name;
                }
            }
            break;
        case 'npm':
            loadPath = modDef.name;
            break;
        default:
            throw new Error('unknown module type '
                + modDef.type + ' (for module ' + modDef.name + ').');
    }
    // Append the log property to module options, if it is not present
    modDef.options = modDef.options || {};
    if (!modDef.options.log) {
        modDef.options.log = this._options.log || function() {};
    }
    // Let the error propagate in case the module cannot be loaded
    var modObj = require(loadPath);
    if (!modObj) {
        return P.reject("Loading module " + loadPath + " failed.");
    }
    // Call if it's a function
    if (modObj instanceof Function) {
        modObj = modObj(modDef.options);
    }
    if (!(modObj instanceof P)) {
        // Wrap
        modObj = P.resolve(modObj);
    }
    return modObj.then(function(mod) {
        if (!mod.operations) {
            throw new Error('No operations exported by module ' + loadPath);
        }
        self._modules.set(modDef, mod);
        return mod;
    });
};

/**
 * Process a Swagger path spec object
 */
Router.prototype._handleSwaggerPathSpec = function(node, pathspec,
        operations, specRoot, prefixPath) {
    var self = this;
    if (!pathspec) {
        return P.resolve();
    }

    // Load sub-specs
    var subSpecs = pathspec['x-subspecs'];
    if (!subSpecs) {
        // Check if there is a single child spec
        var subSpec = pathspec['x-subspec'];
        if (subSpec) {
            var specRootBasePath = specRoot.basePath || '';
            specRoot = Object.assign({}, subSpec);
            specRoot.paths = {};
            specRoot.definitions = {};
            specRoot.securityDefinitions = {};
            specRoot['x-default-params'] = {};
            specRoot.basePath = specRootBasePath + prefixPath;
            prefixPath = '';
            // XXX: The basePath is incorrect when shared between domains. Set
            // it dynamically for each request instead?
            // specRoot.basePath = prefixPath;
            var listNode = new Node();
            listNode.value = {
                specRoot: specRoot,
                methods: {},
                path: specRoot.basePath + '/'
            };
            node.setChild('', listNode);
            subSpecs = [subSpec];
        }
    }

    var loaderPromise = P.resolve();
    if (Array.isArray(subSpecs)) {
        // Load sub-specs
        loaderPromise = loaderPromise.then(function() {
            return P.each(subSpecs, function(subSpecOrPath) {
                var subSpecPromise;
                if (subSpecOrPath instanceof Object) {
                    // Inline sub-spec: return directly
                    subSpecPromise = P.resolve(subSpecOrPath);
                } else {
                    subSpecPromise = self._readSpec(subSpecOrPath);
                }
                return subSpecPromise
                .then(function(subSpec) {
                    return self._handleSwaggerSpec(node, subSpec,
                            operations, specRoot, prefixPath);
                });
            });
        });
    }

    // Load modules
    var restBaseModules = pathspec['x-modules'];
    if (Array.isArray(restBaseModules)) {
        loaderPromise = loaderPromise.then(function() {
            return P.each(restBaseModules, function(m) {
                // Share modules
                return self._loadModule(m)
                .then(function(module) {
                    if (!module) {
                        throw new Error('Null return when loading module ' + m.name);
                    }
                    if (!module.spec) {
                        throw new Error('Module ' + m.name + ' did not export a spec.');
                    }

                    if (module.resources) {
                        // Resources array is shared between nodes,
                        // so need to modify the array, not create a new with concat
                        module.resources.forEach(function(res) {
                            node.value.resources.push(res);
                        });
                    }
                    return self._handleSwaggerSpec(node, module.spec,
                            module.operations, specRoot, prefixPath);
                });
            });
        });
    }

    var security = pathspec.security;
    if (Array.isArray(security)) {
        node.value.security = security.map(function(item) {
            return { value: item };
        }).concat(node.value.security || []);
    }

    return loaderPromise
    // Process HTTP method stanzas ('get', 'put' etc)
    .then(function() {
        // Register the path in the specRoot
        if (specRoot && !specRoot.paths[prefixPath] && prefixPath) {
            specRoot.paths[prefixPath] = {};
        }

        Object.keys(pathspec).forEach(function(methodName) {
            if (/^x-/.test(methodName)) {
                return;
            }
            var method = pathspec[methodName];
            // Insert the method spec into the global merged spec
            if (specRoot.paths[prefixPath]) {
                specRoot.paths[prefixPath][methodName] = method;
            }

            if (node.value.methods[methodName]) {
                throw new Error('Trying to re-define existing method '
                    + node.value.path + ':' + methodName);
            }

            // Check and add method-level security specs
            if (Array.isArray(method.security)) {
                node.value.security = method.security.map(function(item) {
                    return {
                        value: item,
                        method: methodName
                    };
                }).concat(node.value.security || []);
            }

            var backendSetup = method && method['x-setup-handler'];
            if (backendSetup) {
                Array.prototype.push.apply(node.value.resources,
                    handlerTemplate.parseSetupConfig(backendSetup));
            }

            var backendRequest = method && method['x-request-handler'];
            if (backendRequest) {
                node.value.methods[methodName] = handlerTemplate.createHandler(backendRequest);
            } else if (method.operationId) {
                var handler = operations[method.operationId];
                if (handler) {
                    node.value.methods[methodName] = handler;
                } else {
                    throw new Error('No known handler associated with operationId '
                        + method.operationId);
                }
            }
        });
    });
};

/**
 * Process a Swagger spec
 */
Router.prototype._handleSwaggerSpec = function(rootNode, spec, operations, specRoot, prefixPath) {
    if (!specRoot) {
        specRoot = spec;
        if (!spec.paths) { spec.paths = {}; }
        if (!spec.definitions) { spec.definitions = {}; }
        if (!spec.securityDefinitions) { spec.securityDefinitions = {}; }
        if (!spec['x-default-params']) { spec['x-default-params'] = {}; }
        if (!spec.basePath) { spec.basePath  = prefixPath || ''; }
        prefixPath = '';
    }
    if (spec.definitions) {
        // Merge definitions
        Object.assign(specRoot.definitions, spec.definitions);
    }
    if (spec.securityDefinitions) {
        // Merge security definitions
        Object.assign(specRoot.securityDefinitions, spec.securityDefinitions);
    }
    if (spec['x-default-params']) {
        Object.assign(specRoot['x-default-params'], spec['x-default-params']);
    }
    var self = this;
    function handlePaths(paths) {
        if (!paths || !Object.keys(paths).length) {
            // No paths here, nothing to do
            return P.resolve();
        }
        // Handle paths
        return P.all(Object.keys(paths).map(function(pathPattern) {
            var pathSpec = paths[pathPattern];
            var pathURI = new URI(pathPattern, {}, true);
            var path = pathURI.path;
            var subPrefixPath = prefixPath + pathURI.toString('simplePattern');

            // Create a value object early, so that _buildPath can set up a reference
            // to it for optional path segments.
            var value = {
                specRoot: specRoot,
                path: undefined,
                methods: {},
                resources: []
            };

            // Expected to return
            // - rootNode for single-element path
            // - a subnode for longer paths
            var branchNode = self._buildPath(rootNode, path.slice(0, path.length - 1), value);

            // Check if we can share the path spec
            var subtree = self._nodes.get(pathSpec);
            var specPromise;
            if (!subtree) {
                var segment = path[path.length - 1];

                // Check if the subtree already exists, which can happen when
                // specs are overlapping. We don't allow this for now to keep
                // specs easy to read & understand.
                subtree = branchNode.getChild(segment, {});
                if (!subtree) {
                    // Build a new subtree
                    subtree = new Node();
                    // Set up our specific value object
                    subtree.value = value;
                    value.path = specRoot.basePath + subPrefixPath;
                    value.methods = {};
                    // XXX: Set ACLs and other value properties for path
                    // subtree.value.acls = ...;

                    if (segment.modifier === '+') {
                        // Set up a recursive match and end the traversal
                        subtree.setChild(segment, subtree);
                    } else if (segment.modifier === '/') {
                        // Since this path segment is optional, the parent node
                        // has the same value.
                        branchNode.value = value;
                    }
                }

                // Assign the node before building the tree, so that sharing
                // opportunities with the same spec are discovered while doing so
                self._nodes.set(pathSpec, subtree);

                // Handle the path spec
                specPromise = self._handleSwaggerPathSpec(subtree, pathSpec,
                        operations, specRoot, subPrefixPath);
            } else {
                var origSubtree = subtree;
                subtree = subtree.clone();
                subtree.value = value;
                // Copy over the specRoot
                subtree.value.specRoot = origSubtree.value.specRoot;
                subtree.value.path = specRoot.basePath + subPrefixPath;
                subtree.value.resources = origSubtree.value.resources;
                specPromise = P.resolve();
            }
            branchNode.setChild(path[path.length - 1], subtree);
            return specPromise;
        }));
    }

    // TODO: handle global spec settings

    if (spec['x-subspecs'] || spec['x-subspec']) {
        // Allow x-subspecs? at top level spec too. This is useful to avoid
        // introducing an extra level in the spec tree.
        return this._handleSwaggerPathSpec(rootNode, spec, operations, specRoot, prefixPath)
        .then(handlePaths(spec.paths || {}));
    } else {
        return handlePaths(spec.paths || {});
    }
};

/**
 * Set up resources (ex: dynamic storage like tables) by traversing the tree &
 * performing the requests specified in resource stanzas. Default HTTP method
 * is 'put'.
 *
 * Any error during resource creation (status code >= 400) will abort startup
 * after logging the error as a fatal.
 */
Router.prototype.handleResources = function(restbase) {
    var self = this;
    return this.tree.visitAsync(function(value, path) {
        if (value && Array.isArray(value.resources) && value.resources.length > 0) {
            return P.each(value.resources, function(reqSpec) {
                var reqTemplate = new Template(reqSpec);
                var req = reqTemplate.eval({
                    request: {
                        params: {
                            domain: path[0]
                        }
                    }
                });
                if (!req.uri) {
                    throw new Error("Missing resource URI in spec for "
                        + JSON.stringify(path));
                }
                req.method = req.method || 'put';
                return restbase.request(req);
            });
        } else {
            return P.resolve();
        }
    });
};

/**
 * Load a new Swagger spec
 *
 * This involves building a tree, initializing modules, merging specs &
 * initializing resources: Basically the entire app startup.
 */
Router.prototype.loadSpec = function(spec, restbase) {
    var self = this;
    var rootNode = new Node();
    var specPromise;
    if (spec && spec.constructor === String) {
        specPromise = this._readSpec(spec);
    } else {
        specPromise = P.resolve(spec);
    }
    return specPromise
    .then(function(spec) {
        return self._handleSwaggerSpec(rootNode, spec, {});
    })
    .then(function() {
        // Only set the tree after loading everything
        self.tree = rootNode;
        self.router.setTree(rootNode);
        return self.handleResources(restbase);
    })
    .then(function() {
        return self;
    });
};

/**
 * Resolve an URI to a value object
 *
 * Main request routing entry point.
 * @param {URI} uri URI object
 * @return {object} match:
 * - @prop {object} value:
 *   - @prop {object} methods: handlers for methods like get, post etc
 *   - @prop {string} path: path to this tree node
 * - @prop {object} params: Object with path parameters and optionally `_ls`
 *   for URIs ending in `/`.
 */
Router.prototype.route = function(uri) {
    return this.router.lookup(uri);
};

module.exports = Router;
