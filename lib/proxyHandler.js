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
    var traverse = function(path) {
        // A simple dotted path reference
        path.split(/\./).forEach(function(pathBit) {
            // Let errors bubble up, assuming this is all inside of a promise
            context = context[pathBit];
        });
        return context;
    };
    if (/^\$/.test(variable)) {
        return traverse(variable.slice(1));
    } else if (/^\{[^}]+\}$/.test(variable)) {
        var groups = /^\{([^}]+)\}$/.exec(variable);
        return traverse(groups[1]);
    } else if (/^\//.test(variable)) {
        // An URL template
        var urlTemplate = template.parse(variable);
        return urlTemplate.expand(context);
    } else {
        // Treat it as a string literal
        return variable;
    }
}

function expandUrl(url, context) {
    var slugs = url.split('/').filter(function(str){return (/\S/).test(str);});
    var newUrl = {};
    for (var i = 0; i < slugs.length; i++) {
        var slug = slugs[i];
        var expanded = expandVar(slug, context);
        if (/^\{[^}]+\}$/.test(slug)) {
            var groups = /^\{([^}]+)\}$/.exec(slug);
            newUrl[groups[1]] = expanded;
        } else {
            newUrl[slug] = expanded;
        }
    }
    return template.parse(url).expand(newUrl);
}

handler.prototype.parse_req = function(req, parentReq, res) {
    var newReq = {};
    if (req === "$request") {
        return parentReq;
    } else {
        for (var key in req) {
            newReq[key] = expandVar(req[key], { request: parentReq, response: res });
        }
        if (typeof newReq.uri !== 'object' ) {
            newReq.uri = expandUrl(req.uri, { request: parentReq, response: res });
        }
        return newReq;
    }
};

handler.prototype.eval_request = function(spec) {
    return function (req) {
        return this.parse_req(spec, req);
    };
};

function send_request(conf, restbase, req) {
	return restbase.request(req).catch(function(err){
		if (!err.name) {
			throw err;
		}
		return err;
	});
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
        // FIXME: Properly log or throw!
        console.error('Error while reading handler file: ' + e);
    }

    // fetch uri and create handler
    var uri = Object.keys(conf)[0];
    var handler = {}, subConf;
    handler[uri] = {};

    Object.keys(conf[uri]).forEach(function(item){
		subConf = conf[uri][item];
		handler[uri][item.toLowerCase()] = {};
		if (subConf && Object.keys(subConf.request_handler[0])[0]==="send_request" && Object.keys(subConf.request_handler[0])[1]==="on_response") {
			handler[uri][item.toLowerCase()].request_handler = function (restbase, req) {
				self.parentReq = req;
				subConf = conf[uri][req.method.toUpperCase()];
				var newReq = self.parse_req(subConf.request_handler[0].send_request, self.parentReq);
				return send_request(subConf, restbase, newReq).then(self.handle_response.bind(self, subConf.request_handler[0].on_response, restbase, req));
			};
		} else if (subConf && Object.keys(subConf.request_handler[0])[0]==="send_request") {
			handler[uri][item.toLowerCase()].request_handler = function (restbase, req) {
				self.patentReq = req;
				subConf = conf[uri][req.method.toUpperCase()];
				var newReq = self.parse_req(subConf.request_handler[0].send_request, self.parentReq);
				return send_request(subConf, restbase, newReq);
			};
		}
    });
    return handler;
};

module.exports = handler;
