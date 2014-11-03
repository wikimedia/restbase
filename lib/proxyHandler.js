'use strict';

var yaml = require('js-yaml'),
	fs = require('fs');

function match_response(condition, res) {
	var result = true;
	if (condition.if) {
		for (var con in condition.if) {
			// assuming that all if conditon are made on res attributes
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

function send_request(conf, restbase, req) {
    return restbase.request(req);
}

function handle_condition(conf, restbase, res) {
	if ( Object.keys(conf[0])[0]==="send_request" && Object.keys(conf[0])[1]==="on_response" ) {
		//TODO: parse conf.request here
		return send_request(conf, restbase, conf[0].send_request).then(handle_response.bind(this, conf[0].on_response, restbase));
	} else if ( Object.keys(conf[0])[0]==="send_request" ) {
		return send_request(conf, restbase, conf[0].send_request);
	} else if (conf[0].return) {
		return res;
	}
}

function handle_response(conf, restbase, res) {
	var childHandler;
	for(var condition in conf) {
		if ( match_response(conf[condition], res) ) {
			if (conf[condition].else) {
				childHandler = handle_condition(conf[condition].else, restbase, res);
			} else {
				childHandler = handle_condition(conf[condition].then, restbase, res);
			}
			break;
		}
	}
	return new Promise(function(resolve){
		resolve(childHandler);
	});
}

var makeHandler = function(path) {
	var conf;
	try {
        conf = yaml.safeLoad(fs.readFileSync(path));
    } catch (e) {
        console.error('Error while reading config file: ' + e);
    }
    
    // fetch uri
    var uri = Object.keys(conf)[0];
    var handler = {};
    handler[uri] = {};

    Object.keys(conf[uri]).forEach(function(item){
		conf = conf[uri][item];
		handler[uri][item] = {};
		if (conf && Object.keys(conf.request_handler[0])[0]==="send_request" && Object.keys(conf.request_handler[0])[1]==="on_response") {
			handler[uri][item].request_handler = function (restbase, req) {
				//console.log(conf, handler);
				return send_request(conf, restbase, req).then(handle_response.bind(this, conf.request_handler[0].on_response, restbase));
			};
		} else if (conf && Object.keys(conf.request_handler[0])[0]==="send_request") {
			handler[uri][item].request_handler = function (restbase, req) {
				return send_request(conf, restbase, req);
			};
		}
    });
    return handler;
};

module.exports = makeHandler;
