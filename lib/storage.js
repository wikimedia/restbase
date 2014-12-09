"use strict";
/*
 * Storage backend handler.
 */

// global includes
var fs = require('fs');
var util = require('util');
var RouteSwitch = require('routeswitch');

function Storage (options) {
    var self = this;
    this.conf = options.conf;
    this.log = options.log;
    this.setup = this.setup.bind(this);
    this.bucketHandlers = {
        table: function(restbase, req) {
            return self.stores.default(restbase, req);
        }
    };
    this.stores = {};
    this.handler = {
        paths: {
            're:/^\/?$/': {
                get: {
                    summary: "Redirect to v1",
                    request_handler: function(restbase, req) {
                        return Promise.resolve({
                            status: 302,
                            headers: {
                                location: '/v1/'
                            }
                        });
                    }
                }
            },
            '/v1/': {
                get: {
                    summary: "List domains",
                    request_handler: this.listDomains.bind(this)
                }
            },
            '/v1/{domain}': {
                put: {
                    summary: "Create or update a domain",
                    request_handler: this.putDomain.bind(this)
                }
            },
            '/v1/{domain}/': {
                get: {
                    summary: "List buckets and tables for a domain",
                    request_handler: this.listBuckets.bind(this)
                }
            },
            '/v1/{domain}/{bucket}': {
                put: {
                    summary: "Create or update a bucket",
                    request_handler: this.putBucket.bind(this)
                },
                get: {
                    summary: "Get bucket metadata",
                    request_handler: this.getBucket.bind(this)
                }
            },
            '/v1/{domain}/{bucket}/': {
                get: {
                    request_handler: this.handleAll.bind(this)
                }
            },
            '/v1/{domain}/{bucket}/{+rest}': {
                put: {
                    // Delegate to the bucket handler.
                    // No summary, so that this doesn't show up in docs.
                    request_handler: this.handleAll.bind(this)
                },
                get: {
                    request_handler: function(restbase, req) {
                        return self.handleAll(restbase, req);
                    }
                }
            }
        }
    };
}

function makeHandler(handlerSchema) {
    var router = RouteSwitch.fromHandlers([handlerSchema]);
    return function(restbase, req, options) {
        var match = router.match(req.uri);
        if (match) {
            var methods = match.methods;
            var storeHandler = methods[req.method] || methods.all;
            // console.log(req.method, methods, storeHandler);
            if (storeHandler && storeHandler.request_handler) {
                // call it
                req.params = match.params;
                try {
                    return storeHandler.request_handler(restbase, req, options);
                } catch (e) {
                    return Promise.reject(e);
                }
            }
        }
        return Promise.resolve({ status: 404, uri: req.uri, method: req.method });
    };
}

/*
 * Setup / startup
 *
 * @return {Promise<SwaggerSpec>}
 */
Storage.prototype.setup = function setup () {
    var self = this;
    // Set up storage backends
    var storageNames = Object.keys(this.conf.storage);
    var storagePromises = storageNames.map(function(key) {
            var storageConf = self.conf.storage[key];
            try {
                // Storage backends are packaged separately.
                // Example: restbase-cassandra
                var moduleName = storageConf.type;
                //console.log(moduleName);
                // XXX: make this interface more flexible / extensible
                // Perhaps an instance?
                var backend = require(moduleName);
                return backend({
                    conf: storageConf,
                    log: self.log
                });
            } catch (e) {
                self.log('error/setup/backend/' + key, e, e.stack);
                // skip the backend
                Promise.resolve(null);
            }
    });

    return Promise.all(storagePromises)
    .then(function(stores) {
        for (var i = 0; i < stores.length; i++) {
            if (stores[i]) {
                //console.log('success', storageNames[i], stores[i]);

                self.stores[storageNames[i]] = makeHandler(stores[i]);
            }
        }
    })

    // Load bucket handlers
    .then(function() {
        return Promise.promisify(fs.readdir)(__dirname + '/filters/bucket');
    })

    .then(function(handlerNames) {
        var bucketHandlers = [];
        handlerNames.forEach(function (fileName) {
            try {
                // Instantiate one for each configured backend?
                var handlerFn = require(__dirname + '/filters/bucket/' + fileName);
                var handlerName = fileName.replace(/\.js$/, '');
                var handlerSpec = handlerFn(self.log);
                self.bucketHandlers[handlerName] = makeHandler(handlerSpec);
            } catch (e) {
                self.log('warn/setup/bucketHandlers', e, e.stack);
            }
        });
        return self.loadRegistry();
    })

    .then(function(res) {
        //console.log('registry', res);
        self.registry = res;
        // Finally return the handler
        return self.handler;
    });
};

var domainRegistrySchema = {
    table: 'domains',
    attributes: {
        domain: 'string',
        acls: 'json', // default acls for entire domain
        quota: 'varint'
    },
    index: [
        { attribute: 'domain', type: 'hash' }
    ]
};

var tableRegistrySchema = {
    table: 'tables',
    attributes: {
        domain: 'string',
        table: 'string',
        type: 'string',     // 'table' or 'kv' for now
        store: 'string',    // 'default' or uuid
        acls: 'json'
    },
    index: [
        { attribute: 'domain', type: 'hash' },
        { attribute: 'table', type: 'range', order: 'asc' }
    ]
};

Storage.prototype.loadRegistry = function() {
    var self = this;
    var store = function(req) {
        return self.stores.default({}, req);
    };
    // XXX: Retrieve the global config using the default revisioned blob
    // bucket & backend
    var sysDomain = this.conf.sysdomain;

    // make sure the domains table exists
    return Promise.all([
            store({
                method: 'put',
                uri: '/v1/' + sysDomain + '/domains',
                body: domainRegistrySchema
            }),
            store({
                method: 'put',
                uri: '/v1/' + sysDomain + '/tables',
                body: tableRegistrySchema
            })
    ])
    .catch(function(e) {
        self.log('error/storage/loadRegistry/system-table-creation', e);
    })
    // Load the registry
    .then(function() {
        var registry = {};
        var domainQuery = {
            table: 'domains'
        };
        // Load the entire 'domain' registry in one request
        var domainReq = {
            method: 'get',
            uri: '/v1/' + sysDomain + '/domains/',
            body: { table: 'domains' }
        };
        return store(domainReq)
        .then(function(res) {
            if (res.status === 200 || res.status === 404) {
                res.body.items.forEach(function(domainObj) {
                    domainObj.tables = {};
                    registry[domainObj.domain] = domainObj;
                });
                // Load the entire 'table' registry in one request
                return store({
                    method: 'get',
                    uri: '/v1/' + sysDomain + '/tables/',
                    body: { table: 'tables' }
                });
            } else {
                throw JSON.stringify([domainReq, res]);
            }
        })
        .then(function(res) {
            if (res.status === 200 || res.status === 404) {
                //console.log('tables', res);
                res.body.items.forEach(function(tableObj) {
                    var domain = registry[tableObj.domain];
                    if (!domain) {
                        throw new Error('Domain ' + tableObj.domain
                            + ' has tables, but no domain entry!');
                    }
                    domain.tables[tableObj.table] = tableObj;
                });

                return registry;
            } else {
                throw JSON.stringify(res);
            }
        });
    });
};

/**
 * Storage handler dispatcher
 *
 * Looks up domain & bucket or table, authenticates & authorizes the request
 * and calls the bucket or table handler for the method if found.
 */
Storage.prototype.handleAll = function (restbase, req) {
    var self = this;
    var domain = this.registry[req.params.domain.toLowerCase()];
    if (domain) {
        var table = domain.tables[req.params.bucket];
        if (table) {
            // XXX: authenticate against table ACLs
            //console.log(table);
            var bucketHandler = this.bucketHandlers[table.type];
            //console.log(table);
            var storageHandler = this.stores[table.store || 'default'];
            if (bucketHandler || storageHandler) {
                if (bucketHandler) {
                    // Set up the storage backend here, so that requests from
                    // the bucket handler with unchanged URI go to the right
                    // storage backend.
                    restbase.storageHandler = storageHandler;

                    return bucketHandler(restbase, req, table);
                } else {
                    return storageHandler(restbase, req, table);
                }
            } else {
                return Promise.resolve({
                    status: 500,
                    body: {
                        type: 'no_bucket_or_storage_handler_found',
                        title: 'No bucket or storage handler found'
                    }
                });
            }
        } else {
            // Reload the registry to pick up newly created tables
            // XXX:
            // - Be more targeted about reloading
            // - Have some kind of update event stream to avoid doing this on
            //   error
            return self.loadRegistry()
            .then(function(registry) {
                self.registry = registry;
                var newDomain = self.registry[req.params.domain.toLowerCase()];
                if (newDomain) {
                    var newTable = newDomain.tables[req.params.bucket];
                    if (newTable) {
                        return self.handleAll(restbase, req);
                    }
                }
                // Fall through if anything went wrong
                return {
                    status: 404,
                    body: {
                        type: 'not_found',
                        title: 'Not found.',
                        description: 'Table / bucket not found at the storage layer.',
                        localURI: req.uri,
                        table: req.params.bucket
                    }
                };
            });
        }
    } else {
        return Promise.resolve({
            status: 404,
            body: {
                "type":"not_found",
                "description": "Domain " + req.params.domain + " not found for "
                            + req.uri
            }
        });
    }
};

Storage.prototype.listDomains = function (restbase, req) {
    return Promise.resolve({
        status: 200,
        body: {
            items: Object.keys(this.registry)
        }
    });
};

Storage.prototype.putDomain = function (restbase, req) {
    var self = this;
    if (/^\/v1\/[a-zA-Z]+(?:\.[a-zA-Z\.]+)*$/.test(req.uri)) {
        // Insert the domain
        // Verify the domain metadata
        var exampleBody = {
            acls: {},
            quota: 0
        };

        var sysdomain = this.conf.sysdomain;
        var domain = req.params.domain.toLowerCase();
        var query = {
            uri: '/v1/' + sysdomain + '/domains/' + domain,
            method: 'put',
            body: {
                table: 'domains',
                attributes: {
                    domain: domain,
                    acls: req.body.acls,
                    quota: req.body.quota
                }
            }
        };
        return this.stores.default(restbase, query)
        .then(function() {
            return self.loadRegistry()
            .then(function(registry) {
                self.registry = registry;
                return {
                    status: 201,
                    headers: {
                        'content-type': 'application/json'
                    },
                    body: {
                        message: 'Domain created.',
                        domain: domain
                    }
                };
            });
        });
    } else {
        return Promise.resolve({
            status: 400,
            body: {
                message: 'Invalid domain requested'
            }
        });
    }
};

Storage.prototype.putBucket = function (restbase, req) {
    var self = this;
    var rp = req.params;
    // check if the domain exists
    var domain = (req.params.domain || '').toLowerCase();
    if (!this.registry[domain]) {
        return Promise.resolve({
            status: 400,
            body: {
                message: 'Domain does not exist'
            }
        });
    }
    // XXX: fake the body
    //req.body = {
    //    type: 'kv',
    //    revisioned: true,
    //    keyType: 'string',
    //    valueType: 'blob'
    //};
    // Check whether we have a backend for the requested type
    var type = req.body && req.body.type;
    var handler = this.bucketHandlers[type];

    if (handler) {
        // XXX: support other stores?
        restbase.storageHandler = this.stores.default;
        return handler(restbase, req)
        .then(function(res) {
            if (res.status !== 201) {
                return res;
            }
            // Insert the table into the registry
            var query = {
                uri: '/v1/' + self.conf.sysdomain + '/tables/' + rp.bucket,
                method: 'put',
                body: {
                    table: 'tables',
                    attributes: {
                        domain: domain,
                        table: rp.bucket,
                        type: type,
                        options: req.body
                    }
                }
            };
            return self.stores.default(restbase, query)
            .then(function() {
                return self.loadRegistry()
                .then(function(registry) {
                    self.registry = registry;
                })
                .then(function() {
                    return {
                        status: 201,
                        body: {
                            message: 'Bucket ' + rp.bucket + ' created.'
                        }
                    };
                });
            });
        });
    } else {
        return Promise.resolve({
            status: 400,
            body: {
                type: 'invalid_bucket',
                title: "Invalid bucket spec.",
                spec: req.body
            }
        });
    }
};

Storage.prototype.listBuckets = function (restbase, req) {
    var domain = this.registry[req.params.domain];
    if (!domain) {
        return Promise.resolve({
            status: 404,
            body: {
                type: 'not_found',
                title: 'Domain not found',
                uri: req.uri,
                method: req.method
            }
        });
    }
    var tables = domain.tables;
    var listedTables = [];
    Object.keys(tables).forEach(function(table) {
        // TODO: hide private tables using the .acl member!
        // HACK: hide all tables with a dot in them
        if (!/\./.test(table)) {
            listedTables.push(table);
        }
    });

    return Promise.resolve({
        status: 200,
        body: {
            items: listedTables
        }
    });
};

Storage.prototype.getBucket = function (restbase, req) {
    var domain = req.params.domain.toLowerCase();
    var bucket = req.params.bucket;
    var domainData = this.registry[domain];
    if (domainData && domainData.tables[bucket]) {
        return Promise.resolve({
            status: 200,
            body: domainData.tables[bucket]
        });
    } else {
        return Promise.resolve({ status: 404 });
    }
};

Storage.prototype.listBucket = function (restbase, req) {
    var rp = req.params;
    // check if the domain exists
    if (!this.registry[rp.domain]) {
        return Promise.resolve({
            status: 400,
            body: {
                message: 'Domain does not exist'
            }
        });
    }
    var domainInfo = this.registry[rp.domain];
    var bucketInfo = domainInfo.buckets[rp.bucket];
    if (!bucketInfo) {
        return Promise.resolve({
            status: 400,
            body: {
                message: 'Bucket does not exist'
            }
        });
    }

    var handler = this.bucketHandlers[bucketInfo.type];
    //console.log(handler, bucketInfo.type);
    if (handler) {
        //req.uri = '/v1/';
        return handler(req, this.stores.default);
    } else {
        return Promise.resolve({
            status: 400,
            body: {
                message: 'No bucket handler found'
            }
        });
    }
};


/**
 * Factory
 * @param options
 * @return {Promise<registration>} with registration being the registration
 * object
 */
function makeStorage (options) {
    var storage = new Storage(options);
    return storage.setup();
}

module.exports = makeStorage;

