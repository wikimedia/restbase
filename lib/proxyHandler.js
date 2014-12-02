'use strict';

var yaml = require('js-yaml'),
	fs = require('fs'),
	preq = require('preq'),
	template = require('url-template');

var handler = function () {
    this.parentReq = {};
};

function match_response(condition, res) {
	var result = true;
	if (condition.if) {
		for (var con in condition.if) {
			if (res[con] !== condition.if[con]) {
				result = false;
			}
		}
	}

	if (condition.else) {
		return true;
	}
	return result;
}

function expandVar(variable, context) {
    if (/^\$/.test(variable)) {
        // A simple dotted path reference
        variable.slice(1).split(/\./).forEach(function(pathBit) {
            // Let errors bubble up, assuming this is all inside of a promise
            context = context[pathBit];
        });
        return context;
    } else if (/^\//.test(variable)) {
        // An URL template
        var urlTemplate = template.parse(variable);
        return urlTemplate.expand(context);

    } else {
        // Treat it as a string literal
        return variable;
    }
}

handler.prototype.parse_req = function(req, parentReq, res) {
	var newReq = {};
	if (req === "$request") {
		return parentReq;
	} else {
		if (req.method) {
				newReq.method = expandVar(req.method, { request: parentReq, response: res }).toLowerCase();
		} else {
			  throw new Error('Error while reading config file: No req.method found in send_request block');
		}

		// parse the uri
		if (req.url) {
			var arg, reqSplit;
			if (/\{.*\}/.test(req.url)) {
				var newUrl = {};
				// split and remove whitespace
				reqSplit = req.url.split("/").filter(function(str){return (/\S/).test(str);});
				for (var i=0; i<reqSplit.length-2; i++) {
					arg = /\{(.*)\}/.exec(reqSplit[i]);
					if (arg && arg[1].constructor === String) {
						if (/\./.test(arg[1])) {
							newUrl[arg[1]] = expandVar("$"+arg[1], { request: parentReq, response: res });
						} else if (parentReq.params[arg[1]]) {
							newUrl[arg[1]] = parentReq.params[arg[1]];
						} else {
							throw new Error('Invalid arguments {'+arg[1]+'} supplied to URI');
						}
					}
				}

				// Handle the last two part of uri with cases like
				//   - 1. /{foo}{/bar}
				//	 - 2. /foo{/bar}
				//   - 3. /{foo}/{bar}
				//   - 4. /foo/{bar}

				// first handle second last part of uri
				if (/\{[a-z\.A-z]+\}[\{]?|[a-z\.A-Z]+\{/.test(reqSplit[reqSplit.length-2])) {
					arg = /\{([a-z\.A-z]+)\}|\{([a-z\.A-z]+)\}[\{]?/.exec(reqSplit[reqSplit.length-2]);
					if (arg) {
						if (/\./.test(arg[1])) {
							newUrl[arg[1]] = expandVar("$"+arg[1], { request: parentReq, response: res });
						} else if (/\./.test(arg[2])) {
							newUrl[arg[2]] = expandVar("$"+arg[2], { request: parentReq, response: res });
						} else if(parentReq.params[arg[1]]) {
							newUrl[arg[1]] = this.parentReq.params[arg[1]];
						} else if (parentReq.params[arg[2]]) {
							newUrl[arg[2]] = parentReq.params[arg[2]];
						} else {
							throw new Error('Invalid argument supplied to URI - '+req.url);
						}
					}
				}

				// handle last part of uri
				if (/.*\}/.test(reqSplit[reqSplit.length-1])) {
					arg = /([a-z\.A-z]*)\}/.exec(reqSplit[reqSplit.length-1]);
					if (arg && arg[1]) {
						if (/\./.test(arg[1])) {
							newUrl[arg[1]] = expandVar("$"+arg[1], { request: parentReq, response: res });
						} else if (this.parentReq.params[arg[1]]) {
							newUrl[arg[1]] = this.parentReq.params[arg[1]];
						} else {
							throw new Error('Invalid arguments {'+arg[1]+'} supplied to URI');
						}
					}
				}
				var url = template.parse(req.url);
				newReq.uri = url.expand(newUrl);
			} else {
				newReq.uri = req.uri;
			}
		} else {
			throw new Error('Error while reading config file: No req.url found in send_request block');
		}

		if (req.headers) {
				newReq.headers = expandVar(req.headers, { request: parentReq, response: res });
		}

		if (req.query) {
			for (var item in req.query) {
					req.query[item] = expandVar(req.query[item], { request: parentReq, response: res });
			}
			newReq.query = req.query;
		}

		if (req.body) {
				newReq.body = expandVar(req.body, { request: parentReq, response: res });
		}
		return newReq;
	}
};

function send_request(conf, restbase, req) {
	return restbase.request(req);
}

handler.prototype.handle_condition = function(conf, restbase, req, res) {
	if ( Object.keys(conf[0])[0]==="send_request" && Object.keys(conf[0])[1]==="on_response" ) {
		var newReq = this.parse_req(conf[0].send_request, this.parentReq, res);
		return send_request(conf, restbase, newReq).then(this.handle_response.bind(this, conf[0].on_response, restbase, newReq));
	} else if ( Object.keys(conf[0])[0]==="send_request" ) {
		return send_request(conf, restbase, conf[0].send_request);
	} else if (conf[0].return) {
		return res;
	}
};

handler.prototype.handle_response = function (conf, restbase, req, res) {
	var childHandler;
	for(var condition in conf) {
		if (conf[condition].return) {
			return new Promise(function(resolove){  resolove(res); });
		}
		if (conf[condition].else) {
			childHandler = this.handle_condition(conf[condition].else, restbase, req, res);
			break;
		}
		if ( match_response(conf[condition], res) ) {
			childHandler = this.handle_condition(conf[condition].then, restbase, req, res);
			break;
		}
	}
	return new Promise(function(resolve){
		resolve(childHandler);
	});
};

handler.prototype.makeHandler = function(path) {
	var self = this;
	var conf;
	try {
        conf = yaml.safeLoad(fs.readFileSync(path));
    } catch (e) {
        console.error('Error while reading config file: ' + e);
    }
    
    // fetch uri and create handler
    var uri = Object.keys(conf)[0];
    var handler = {};
    handler[uri] = {};

    Object.keys(conf[uri]).forEach(function(item){
		conf = conf[uri][item];
		handler[uri][item.toLowerCase()] = {};
		if (conf && Object.keys(conf.request_handler[0])[0]==="send_request" && Object.keys(conf.request_handler[0])[1]==="on_response") {
			handler[uri][item.toLowerCase()].request_handler = function (restbase, req) {
				self.parentReq = req;
				var newReq = self.parse_req(conf.request_handler[0].send_request, self.parentReq);
				return send_request(conf, restbase, newReq).then(self.handle_response.bind(self, conf.request_handler[0].on_response, restbase, req));
			};
		} else if (conf && Object.keys(conf.request_handler[0])[0]==="send_request") {
			handler[uri][item.toLowerCase()].request_handler = function (restbase, req) {
				self.patentReq = req;
				var newReq = self.parse_req(conf.request_handler[0].send_request, self.parentReq);
				return send_request(conf, restbase, newReq);
			};
		}
    });
    return handler;
};

module.exports = handler;
