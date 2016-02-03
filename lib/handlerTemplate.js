'use strict';

/*
 * A backend request handler definition template, that compiles a handler spec
 * into an executable function.
 */

var P = require('bluebird');
var Template = require('swagger-router').Template;
var stringify = require('json-stable-stringify');

/**
 * Creates a JS function that verifies property equality
 *
 * @param catchDefinition the condition in the format of 'catch' and 'return_if' stanza
 * @returns {Function} a function that verifies the condition
 */
function compileCatchFunction(catchDefinition) {
    function createCondition(catchCond, option) {
        if (catchCond === 'status') {
            var opt = option.toString();
            if (/^[0-9]+$/.test(opt)) {
                return '(res["' + catchCond + '"] === ' + opt + ')';
            } else if (/^[0-9x]+$/.test(opt)) {
                return 'Array.isArray(res["' + catchCond
                    + '"].toString().match(/^' + opt.replace(/x/g, "\\d")
                    + '$/))';
            } else {
                throw new Error('Invalid catch condition ' + opt);
            }
        } else {
            return '(stringify(res["' + catchCond + '"]) === \''
                        + stringify(option) + '\')';
        }
    }

    var condition = [];
    var code;
    Object.keys(catchDefinition).forEach(function(catchCond) {
        if (Array.isArray(catchDefinition[catchCond])) {
            var orCondition = catchDefinition[catchCond].map(function(option) {
                return createCondition(catchCond, option);
            });
            condition.push('(' + orCondition.join(' || ') + ')');
        } else {
            condition.push(createCondition(catchCond, catchDefinition[catchCond]));
        }
    });
    code = 'return (' + condition.join(' && ') + ');';
    /* jslint evil: true */
    return new Function('stringify', 'res', code).bind(null, stringify);
}

/**
 * Count the number of request step stanzas with 'return' or 'return_if'
 * statements.
 * @param stepConf step config object
 * @returns {boolean} true if there's 'return' or 'return_if' in the step
 */
function countReturnsInStep(stepConf, withConditionals) {
    return Object.keys(stepConf)
        .filter(function(requestName) {
            return stepConf[requestName].return
                ||  withConditionals && stepConf[requestName].return_if;
        })
        .length;
}

/**
 * Validates a single step in the request chain
 *
 * @param {object} stepConf step configuration with optional
 *                 'request', 'return', 'return_if' and 'catch' properties.
 */
function validateStep(stepConf) {
    // Returning steps can't be parallel
    var returnsInStep = countReturnsInStep(stepConf, true);
    if (returnsInStep > 1) {
        throw new Error('Invalid spec. ' +
        'Returning requests cannot be parallel. Spec: ' + JSON.stringify(stepConf));
    }

    // Either 'request' or 'return' must be specified
    if (!Object.keys(stepConf).every(function(requestName) {
        return stepConf[requestName].request || stepConf[requestName].return;
    })) {
        throw new Error('Invalid spec. ' +
        'Either request or return must be specified. Step: ' + JSON.stringify(stepConf));
    }

    // Only supply 'return_if' when 'request' is specified
    if (Object.keys(stepConf).some(function(requestName) {
        return stepConf[requestName].return_if && !stepConf[requestName].request;
    })) {
        throw new Error('Invalid spec. ' +
        'return_if should have a matching request. Step: ' + JSON.stringify(stepConf));
    }

    // Only supply 'catch' when 'request' is specified
    if (Object.keys(stepConf).some(function(requestName) {
        return stepConf[requestName].catch && !stepConf[requestName].request;
    })) {
        throw new Error('Invalid spec. ' +
        'catch should have a matching request. Step: ' + JSON.stringify(stepConf));
    }
}

/**
 * Validates the specification of the service,
 * throws Error if some of the rules are not met.
 *
 * Current rules:
 *  - request handler spec must be an array
 *  - returning steps can't be parallel
 *  - either 'request' or 'return' must be specified in each step
 *  - 'return_if' is allowed only if 'request' is specified in a step
 *  - 'catch' is allowed only if 'request' is specified in a step
 *  - last step in a request chain can't be parallel
 *
 * @param {object} spec service spec object
 */
function validateSpec(spec) {
    if (!spec || !Array.isArray(spec)) {
        throw new Error('Invalid spec. It must be an array of request block definitions.' +
            ' Spec: ' + JSON.stringify(spec));
    }
    spec.forEach(validateStep);

    // Last step must have a return, or only a single request.
    var lastStep = spec[spec.length - 1];
    if (countReturnsInStep(lastStep) === 0) {
        if (Object.keys(lastStep).length > 1) {
            throw new Error('Invalid spec. Need a return if the last step is parallel.');
        } else {
            // Make the last step a return step.
            var lastRequestName = Object.keys(lastStep)[0];
            lastStep[lastRequestName].return = true;
        }
    }
}

function courteousExpand(template, ctx, info) {
    try {
        return template.expand(ctx.model);
    } catch (e) {
        e.reqName = info.reqName;
        e.reqSpec = info.spec;
        throw e;
    }
}

/**
 * Creates a request handler.
 * @param info, info about a request.
 *          - {string name: request name
 *          - {object} spec: object containing a request template
 * @return
 */
function makeRequestHandler(info, options) {
    if (info.spec.request) {
        var template;
        try {
            template = new Template(info.spec.request, options.globals);
        } catch (e) {
            e.requestName = info.name;
            e.requestSpec = info.spec.spec;
            e.message = 'Template compilation failed. See .spec for details. ' + e.message;
            throw e;
        }

        var catchPred;
        if (info.spec.catch) {
            catchPred = compileCatchFunction(info.spec.catch);
        }

        var shouldReturn;
        // Important: `return_if` takes precedence over return, so that a
        // `return` with `return_if` present behaves like `response`.
        if (info.spec.return_if) {
            // Conditional return.
            var returnPred = compileCatchFunction(info.spec.return_if);
            shouldReturn = function(res) {
                return returnPred(res) && info.name;
            };
        } else if (info.spec.return) {
            // Unconditional return.
            shouldReturn = function() { return info.name; };
        } else {
            shouldReturn = function() { return false; };
        }

        // Specialized version for performance.
        if (catchPred) {
            return function(ctx) {
                var req = courteousExpand(template, ctx, info);
                if (!req.method) {
                    // TODO: trace down callers that don't set a proper method!
                    req.method = ctx.model.request.method
                        || options.defaultMethod || 'get';
                }
                return ctx.hyper.request(req)
                .then(function(res) {
                    ctx.model[info.name] = res;
                    ctx._doReturn = ctx._doReturn || shouldReturn(res);
                }, function(res) {
                    ctx.model[info.name] = res;
                    if (catchPred(res)) {
                        ctx._doReturn = ctx._doReturn || shouldReturn(res);
                    } else {
                        res.requestName = info.name;
                        throw res;
                    }
                });
            };
        } else if (!info.spec.return_if && info.spec.return) {
            return function(ctx) {
                var req = courteousExpand(template, ctx, info);
                if (!req.method) {
                    // TODO: trace down callers that don't set a proper method!
                    req.method = ctx.model.request.method
                        || options.defaultMethod || 'get';
                }
                // Set up the return no matter what.
                ctx._doReturn = info.name;
                return ctx.hyper.request(req)
                .then(function(res) {
                    ctx.model[info.name] = res;
                    ctx._doReturn = info.name;
                });
            };
        } else {
            return function(ctx) {
                var req = courteousExpand(template, ctx, info);
                if (!req.method) {
                    // TODO: trace down callers that don't set a proper method!
                    req.method = ctx.model.request.method
                        || options.defaultMethod || 'get';
                }
                return ctx.hyper.request(req)
                .then(function(res) {
                    ctx.model[info.name] = res;
                    ctx._doReturn = ctx._doReturn || shouldReturn(res);
                });
            };
        }
    }
}

function makeResponseHandler(info, options) {
    var returnOrResponse = info.spec.return || info.spec.response;
    if (returnOrResponse) {
        var doReturn = info.spec.return && !info.spec.return_if && info.name;
        var conditionalReturn = info.spec.return_if;
        if (typeof returnOrResponse === 'object') {
            var template = new Template(returnOrResponse, options.globals);
            return function(ctx) {
                // Don't evaluate if a conditional return didn't trigger, as
                // that is often used to handle error conditions.
                if (ctx._doReturn || !conditionalReturn) {
                    ctx.model[info.name] = courteousExpand(template, ctx, info);
                }
                ctx._doReturn = ctx._doReturn || doReturn;
            };
        }
    }
}

// Set up the request phase in a parallel execution step.
function makeStepRequestHandler(reqHandlerInfos) {
    var handlers = [];
    reqHandlerInfos.forEach(function(info) {
        if (info.requestHandler) {
            handlers.push(function(ctx) {
                return info.requestHandler(ctx)
                .catch(function(e) {
                    e.requestName = info.name;
                    throw e;
                });
            });
        }
    });

    if (handlers.length) {
        // Call all request handlers in a step in parallel.
        return function(ctx) {
            return P.map(handlers, function(handler) {
                return handler(ctx);
            });
        };
    } else {
        // Nothing to do.
        return null;
    }
}

// Set up the response massaging phase for requests in a parallel execution
// step.
function makeStepResponseHandler(reqHandlerInfos) {
    var returnHandlerInfos = [];
    reqHandlerInfos.forEach(function(info) {
        if (info.responseHandler) {
            returnHandlerInfos.push({
                name: info.name,
                handler: info.responseHandler,
            });
        }
    });

    if (returnHandlerInfos.length) {
        return function(ctx) {
            returnHandlerInfos.forEach(function(info) {
                try {
                    info.handler(ctx);
                } catch (e) {
                    e.requestName = info.name;
                    throw e;
                }
            });
        };
    } else {
        return null;
    }
}

/**
 * Set up a handler function to run one full step.
 *
 * - Compile all requests in the step into request / response handlers.
 * - Aggregate those into two handlers for step-global request & response
 *   phases.
 * - Return the right Promise arrangement to call both, in order.
 */
function makeStep(stepSpec, options) {
    var reqHandlerInfos = Object.keys(stepSpec).map(function(reqName) {
        var reqSpec = stepSpec[reqName];
        var reqHandlerInfo = {
            name: reqName,
            spec: reqSpec,
        };
        reqHandlerInfo.requestHandler = makeRequestHandler(reqHandlerInfo, options);
        reqHandlerInfo.responseHandler = makeResponseHandler(reqHandlerInfo, options);

        return reqHandlerInfo;
    });

    // Create one function to call all handlers in a step.
    //
    // We execute the requests in a single step in two phases avoid race
    // conditions between parallel requests referencing each other:
    // 1) execute all requests, .catch, and evaluate return_if conditions
    var requestHandler = makeStepRequestHandler(reqHandlerInfos);

    // 2) Massage the response(s) by applying return / response specs.
    var responseHandler = makeStepResponseHandler(reqHandlerInfos);

    // Returns are signaled via ctx._doReturn, set in the requestHandler if
    // `return` is set or the `return_if` condition evaluates to `true` based
    // on the original response.

    if (requestHandler) {
        if (responseHandler) {
            return function(ctx) {
                return requestHandler(ctx)
                    .then(function() {
                        return responseHandler(ctx);
                    });
            };
        } else {
            return requestHandler;
        }
    } else {
        if (responseHandler) {
            return function(ctx) {
                return P.resolve(responseHandler(ctx));
            };
        } else {
            // Really nothing to do at all.
            return function(ctx) {
                return P.resolve(ctx);
            };
        }
    }
}

/**
 * Run one step at a time, and take care of returning the right value /
 * scheduling the next step.
 */
function runStep(steps, i, ctx) {
    var step = steps[i];
    var stepPromise = step(ctx);
    if (i < steps.length - 1) {
        return stepPromise.then(function() {
            if (ctx._doReturn) {
                return ctx.model[ctx._doReturn];
            } else {
                return runStep(steps, i + 1, ctx);
            }
        });
    } else {
        // All done. Return in any case.
        return stepPromise.then(function() {
            return ctx.model[ctx._doReturn];
        });
    }
}


/**
 * Creates a handler function from the handler spec.
 *
 * @param spec - a request handler spec
 * @param {object} options, with attributes:
 *          - globals: an object to merge into the globals available in the
 *                  global handler scope.
 *          - defaultMethod: request method used for templates without an
 *                  explicit method set; defaults to 'get'.
 * @returns {Function} a request handler
 */
function createHandler(spec, options) {
    options = options || {};
    if (!options.globals) { options.globals = {}; }

    validateSpec(spec);

    // Remember non-functions in options.globals, so that we can add them to
    // the model.
    var modelInit = {};
    Object.keys(options.globals).forEach(function(key) {
        if (typeof options.globals[key] !== 'function') {
            modelInit[key] = options.globals[key];
        }
    });
    if (!Object.keys(modelInit).length) {
        modelInit = null;
    }

    // Compile all the parallel execution steps into functions.
    var steps = spec.map(function(stepSpec) {
        return makeStep(stepSpec, options);
    });

    return function(hyper, req) {
        var ctx = {
            hyper: hyper,
            // The root model exposed to templates.
            model: {
                request: req,
            },

            // This contains the name of the request to return, once it is
            // ready to be returned. This is triggered unconditionally by the
            // return: statement, and conditionally by the return_if:
            // statement if its predicate evaluates to true.
            _doReturn: false,
            _spec: spec,
        };
        if (modelInit) {
            var model = ctx.model;
            // Don't use Object.assign, as we want to give precedence to the
            // model.
            Object.keys(modelInit).forEach(function(key) {
                if (model[key] === undefined) {
                    model[key] = modelInit[key];
                }
            });
        }
        return runStep(steps, 0, ctx);
    };
}

/**
 * Processes an x-setup-handler config and returns all resources
 *
 * @param {object} setupConf an endpoint configuration object
 * @param {object} options, with attributes:
 *          - globals: an object to merge into the globals available in the
 *                  global handler scope.
 *
 * TODO: Use createHandler to create a real handler?
 */
function parseSetupConfig(setupConf, options) {
    var result = [];
    if (Array.isArray(setupConf)) {
        setupConf.forEach(function(resourceSpec) {
            Object.keys(resourceSpec).forEach(function(requestName) {
                var requestSpec = resourceSpec[requestName];
                requestSpec.method = requestSpec.method || 'put';
                result.push(requestSpec);
            });
        });
    } else {
        throw new Error('Invalid config. x-setup-handler must be an array');
    }
    return result;
}

module.exports = {
    createHandler: createHandler,
    parseSetupConfig: parseSetupConfig
};

