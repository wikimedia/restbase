"use strict";

var P = require('bluebird');
var yaml = require('js-yaml');
var fs = P.promisifyAll(require('fs'));
var rbUtil = require('./rbUtil');
var handlerTemplate = require('./handlerTemplate');
var swaggerRouter = require('swagger-router');
var Validator = require('./validator');

var Node = swaggerRouter.Node;
var Template = swaggerRouter.Template;
var URI = swaggerRouter.URI;
var SwaggerRouter = swaggerRouter.Router;


/**
 *
 * @param {object} init
 *      - {string} prefixPath: The prefix within the current API scope
 *      - {object} specRoot, the root of the merged spec for the current API
 *      scope
 *      - {object} globals, global config data / options
 *      - {object} operations, Object mapping operationId -> handler
 */
function ApiScope(init) {
    if (!init) {
        init = {};
    }
    this.prefixPath = init.prefixPath || '';

    var specRoot = this.specRoot = init.specRoot || {};
    if (!specRoot.paths) { specRoot.paths = {}; }
    if (!specRoot.definitions) { specRoot.definitions = {}; }
    if (!specRoot.securityDefinitions) { specRoot.securityDefinitions = {}; }
    if (specRoot.basePath === undefined) { specRoot.basePath  = this.prefixPath; }

    this.globals = init.globals || {};
    this.operations = init.operations || {};
}

ApiScope.prototype.makeChild = function(overrides) {
    var newScope = new ApiScope(this);
    Object.assign(newScope, overrides);
    return newScope;
};


function Router(options) {
    this._options = options || {};
    this._nodes = new Map();
    this._modules = new Map();
    this.router = new SwaggerRouter();
    this.log = this._options.log || function() {};
}

// Load & parse a yaml spec from disk
Router.prototype._readSpec = function(path) {
    var fsPath = __dirname + '/../';
    if (/^\//.test(path)) {
        // absolute path
        fsPath = path;
    } else if (/\.yaml$/.test(path)) {
        fsPath += path;
    } else {
        fsPath += 'specs/' + path + '.yaml';
    }
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
Router.prototype._loadModule = function(modDef, globals) {

    var self = this;

    // First, check if we have a copy of this module in the cache, so that we
    // can share it.
    var cachedModule = self._modules.get(modDef);
    if (cachedModule && cachedModule._parentGlobals === globals) {
        return P.resolve(cachedModule);
    }

    var loadPath;

    var modType = modDef.type;
    if (modDef.path && !modType) {
        // infer the type from the path
        if (/\.js$/.test(modDef.path)) {
            modType = 'file';
        } else if (/\.yaml$/.test(modDef.path)) {
            modType = 'spec';
        }
    }

    // Determine the module's load path
    switch (modType) {
        case 'file':
        case 'spec':
            if (modDef.path && /^\//.test(modDef.path)) {
                // Absolute path
                loadPath = modDef.path;
            } else {
                // Relative path or missing
                loadPath = __dirname + '/../';
                if (modDef.path) {
                    // The path has been provided, use it
                    loadPath += modDef.path;
                } else {
                    // No path given, so assume the file name matches the
                    // module name & the default 'mods' dir is used.
                    loadPath += 'mods/' + modDef.name;
                }
            }
            break;
        case 'npm':
            loadPath = modDef.name;
            break;
        default:
            throw new Error('unknown module type '
                + modDef.type + ' (for module ' + (modDef.name || modDef) + ').');
    }

    // Expand options in the parent context, so that config options can be
    // passed down the chain.
    var options = {};
    if (modDef.options) {
        // Protect "templates" property from expansion.
        var templates = modDef.options.templates;
        delete modDef.options.templates;
        options = new Template(modDef.options).expand(globals) || {};
        // Add the original "templates" property back.
        options.templates = templates;
    }

    // Append the log property to module options, if it is not present
    if (!options.log) {
        options.log = this._options.log || function() {};
    }
    if (modType === 'spec') {
        if (!/\.yaml$/.test(loadPath)) {
            loadPath += '.yaml';
        }
        return fs.readFileAsync(loadPath)
        .then(function(specSrc) {
            var spec = yaml.safeLoad(specSrc);
            var mod = {
                spec: spec,
                globals: { options: options, log: options.log },
                // Needed to check cache validity.
                _parentGlobals: globals,
            };
            self._modules.set(modDef, mod);
            return mod;
        });
    } else {
        // Let the error propagate in case the module cannot be loaded
        var modObj = require(loadPath);
        if (!modObj) {
            return P.reject("Loading module " + loadPath + " failed.");
        }
        // Call if it's a function
        if (modObj instanceof Function) {
            modObj = modObj(options);
        }
        if (!(modObj instanceof P)) {
            // Wrap
            modObj = P.resolve(modObj);
        }
        return modObj.then(function(mod) {
            if (!mod.operations && !mod.globals) {
                throw new Error('No operations exported by module ' + loadPath);
            }
            if (!mod.globals) { mod.globals = {}; }
            mod.globals.log = options.log;
            // Needed to check cache validity.
            mod._parentGlobals = globals;
            self._modules.set(modDef, mod);
            return mod;
        });
    }
};

Router.prototype._loadModules = function(node, restBaseModules, scope) {
    var self = this;
    if (Array.isArray(restBaseModules)) {
        throw new Error('Old style module config detected! '
                + 'New format expects an object, not an array. '
                + 'Please update your config.');
    } else if (typeof restBaseModules !== 'object') {
        return P.resolve();
    }

    return P.each(Object.keys(restBaseModules), function(modulePath) {
        var pathMods = restBaseModules[modulePath];
        if (!Array.isArray(pathMods)) {
            throw new Error('Error in module definition for ' + modulePath + '!\n'
                    + 'Expected an array, got ' + pathMods);
        }
        return P.each(pathMods, function(m) {
            // Share modules
            return self._loadModule(m, scope.globals)
            .then(function(module) {
                if (!module) {
                    throw new Error('Null return when loading module ' + modulePath);
                }
                if (!module.spec) {
                    throw new Error('Module ' + modulePath + ' did not export a spec.');
                }

                if (module.resources) {
                    // Resources array is shared between nodes,
                    // so need to modify the array, not create a new with concat
                    module.resources.forEach(function(res) {
                        node.value.resources.push(res);
                    });
                }
                var childScope = scope.makeChild({
                    operations: module.operations,
                    globals: module.globals,
                });
                var prefixPath = modulePath !== '/' ? modulePath : '';
                return self._handleSwaggerSpec(node, module.spec, childScope, prefixPath);
            });
        });
    });
};

/**
 * Register paths, handlers & other data in the node & the specRoot.
 * @param {Node}
 * @param {object} pathspec
 * @param {ApiScope} scope
 */
Router.prototype._registerPaths = function(node, pathspec, scope) {
    var self = this;

    // Register the path in the specRoot
    if (scope.specRoot && !scope.specRoot.paths[scope.prefixPath]
            // But don't load empty paths.
            && scope.prefixPath) {
        scope.specRoot.paths[scope.prefixPath] = {};
    }

    Object.keys(pathspec).forEach(function(methodName) {
        if (/^x-/.test(methodName)) {
            return;
        }
        var method = pathspec[methodName];
        // Insert the method spec into the global merged spec
        if (scope.specRoot.paths[scope.prefixPath] && methodName
                && !scope.specRoot.paths[scope.prefixPath][methodName]) {
            scope.specRoot.paths[scope.prefixPath][methodName] = method;
        }

        if (node.value.methods.hasOwnProperty(methodName)) {
            var e = new Error('Trying to re-define existing method '
                + node.value.path + ':' + methodName);
            e.pathspec = pathspec;
            throw e;
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
            node.value.methods[methodName] = handlerTemplate.createHandler(backendRequest, {
                globals: node.value.globals,
            });
        } else if (method.operationId) {
            var handler = scope.operations[method.operationId];
            if (handler) {
                node.value.methods[methodName] = handler;
            } else {
                throw new Error('No known handler associated with operationId '
                    + method.operationId);
            }
        }

        var invalidHandlerSpec = method && method['x-invalid-response-handler'];
        if (invalidHandlerSpec) {
            var originalHandler = node.value.methods[methodName];
            var invalidHandler = handlerTemplate.createHandler(invalidHandlerSpec);
            node.value.methods[methodName] = function(restbase, req) {
                if (req.headers && /no-cache/i.test(req.headers['cache-control'])) {
                    // It's already a no-cache request, we can't do anything with a
                    // non-matching result content-type
                    return P.try(originalHandler, [restbase, req])
                    .then(function(res) {
                        if (!rbUtil.contentTypeMatch(res, method.produces)) {
                            self.log('warn/responseValidation', {
                                message: 'Invalid response',
                                req: req,
                                res: res,
                                spec: method
                            });
                        }
                        return res;
                    });
                } else {
                    return P.try(originalHandler, [restbase, req])
                    .then(function(res) {
                        if (!rbUtil.contentTypeMatch(res, method.produces)) {
                            return invalidHandler(restbase, req);
                        }
                        return res;
                    });
                }
            };
        }

        if (method && method.parameters && node.value.methods[methodName]) {
            node.value.methods[methodName].validator = new Validator(method.parameters);
        }
    });
};

/**
 * Process a Swagger path spec object
 */
Router.prototype._handleSwaggerPathSpec = function(node, pathspec, scope, parentSegment) {
    var self = this;
    if (!pathspec) {
        return P.resolve();
    }

    if (pathspec['x-subspec'] || pathspec['x-subspecs']) {
        throw new Error('x-subspec and x-subspecs is no longer supported! '
                + 'Use x-modules instead.');
    }

    // Load sub-spec
    var loaderPromise = P.resolve();
    if (parentSegment && parentSegment.name === 'api') {
        // This is a new API at a path like /en.wikipedia.org/v1, so create a new specRoot.
        var specRoot = Object.assign({}, pathspec);
        specRoot.swagger = specRoot.swagger || '2.0';
        specRoot.paths = {};
        specRoot.definitions = {};
        specRoot.securityDefinitions = {};
        specRoot['x-default-params'] = {};
        specRoot.basePath = (scope.specRoot.basePath || '') + scope.prefixPath;
        // XXX: The basePath is incorrect when shared between domains. Set
        // it dynamically for each request instead?
        specRoot.basePath = scope.prefixPath;
        scope = scope.makeChild({
            specRoot: specRoot,
            operations: {},
            prefixPath: '',
        });

        var listNode = new Node();
        listNode.value = {
            specRoot: specRoot,
            methods: {},
            path: specRoot.basePath + '/',
            globals: node.value.globals,
        };
        node.setChild('', listNode);

        loaderPromise = loaderPromise.then(function() {
            return self._handleSwaggerSpec(node, pathspec, scope);
        });
    } else {
        loaderPromise = loaderPromise.then(function() {
            return self._handlePaths(node, pathspec, scope);
        });
    }

    // Load modules
    var restBaseModules = pathspec['x-modules'];
    if (restBaseModules) {
        loaderPromise = loaderPromise.then(function() {
            return self._loadModules(node, restBaseModules, scope);
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
        return self._registerPaths(node, pathspec, scope);
    });
};


/**
 * @param {object} spec, the spec potentially containing a paths object.
 * @param {Node} rootNode, the node all paths are branching from.
 * @param {ApiScope} scope
 * @param {string} optionalPathPrefix, an optional path prefix to prepend to
 *                  each processed path.
 * @return {Promise<void>}
 **/
Router.prototype._handlePaths = function(rootNode, spec, scope, optionalPathPrefix) {
    var self = this;
    var paths = spec.paths;
    if (!paths || !Object.keys(paths).length) {
        // No paths here, nothing to do
        return P.resolve();
    }

    if (!optionalPathPrefix) {
        optionalPathPrefix = '';
    }

    // Handle paths
    // Sequence the build process with `.each` to avoid race conditions
    // while building the tree.
    return P.each(Object.keys(paths), function(pathPattern) {
        var pathSpec = paths[pathPattern];
        var pathURI = new URI(optionalPathPrefix + pathPattern, {}, true);
        var path = pathURI.path;

        var childScope = scope.makeChild({
            prefixPath: scope.prefixPath + pathURI.toString('simplePattern'),
        });

        // Create a value object early, so that _buildPath can set up a reference
        // to it for optional path segments.
        var value = {
            specRoot: childScope.specRoot,
            path: undefined,
            methods: {},
            resources: [],
            globals: childScope.globals || {},
        };

        // Expected to return
        // - rootNode for single-element path
        // - a subnode for longer paths
        var branchNode = self._buildPath(rootNode, path.slice(0, path.length - 1), value);

        // Check if we can share the subtree for the pathspec.
        var subtree = self._nodes.get(pathSpec);
        var specPromise;
        if (!subtree || subtree._parentGlobals !== childScope.globals) {
            var segment = path[path.length - 1];

            // Check if the subtree already exists, which can happen when
            // specs are overlapping.
            subtree = branchNode.getChild(segment, {});
            if (!subtree) {
                // Build a new subtree
                subtree = new Node();
                // Set up our specific value object
                subtree.value = value;
                value.path = childScope.specRoot.basePath + childScope.prefixPath;
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

                if (Object.keys(pathSpec).length === 1 && pathSpec['x-modules']) {
                    subtree._parentGlobals = childScope.globals;
                    self._nodes.set(pathSpec, subtree);
                }
            }


            // Handle the path spec
            specPromise = self._handleSwaggerPathSpec(subtree, pathSpec, childScope, segment);
        } else {
            // Share the subtree.
            var origSubtree = subtree;
            subtree = subtree.clone();
            subtree.value = value;
            // Copy over the remaining value properties.
            Object.assign(subtree.value, origSubtree.value);
            subtree.value.path = childScope.specRoot.basePath + childScope.prefixPath;
            specPromise = P.resolve();
        }
        branchNode.setChild(path[path.length - 1], subtree);
        return specPromise;
    });
};

/**
 * Process a Swagger spec.
 * @param {Node} rootNode
 * @param {object} spec
 * @param {ApiScope} scope
 * @param {string} optionalPathPrefix, optional path prefix to prepend to all
 *                  paths in the spec.
 * @return {Promise<void>}
 */
Router.prototype._handleSwaggerSpec = function(rootNode, spec, scope, optionalPathPrefix) {

    if (spec.definitions) {
        // Merge definitions
        Object.assign(scope.specRoot.definitions, spec.definitions);
    }
    if (spec.securityDefinitions) {
        // Merge security definitions
        Object.assign(scope.specRoot.securityDefinitions, spec.securityDefinitions);
    }
    var self = this;

    return self._handlePaths(rootNode, spec, scope, optionalPathPrefix);
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
                var req = reqTemplate.expand({
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
        var scope = new ApiScope({
            globals: {
                options: restbase.rb_config,
            }
        });
        return self._handleSwaggerSpec(rootNode, spec, scope);
    })
    .then(function() {
        // Only set the tree after loading everything
        // console.log(JSON.stringify(rootNode, null, 2));
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
