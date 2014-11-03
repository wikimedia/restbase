'use strict';

var yaml = require('js-yaml'),
	fs = require('fs');

if (!global.Promise) {
    global.Promise = require('bluebird');
} else if (!Promise.promisify) {
    // Node 0.11+
    Promise.promisify = require('bluebird').promisify;
}

var restbase = { request :
	function(req) {
		console.log("request made - \n", req);
		return new Promise(function(resolve, reject) {
			console.log("fake response - {status:404} \n");
			resolve({status:404});
		});
	}
};

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

function handle_condition(conf, res) {
	if ( Object.keys(conf[0])[0]==="send_request" && Object.keys(conf[0])[1]==="on_response" ) {
		//TODO: parse conf.request here
		return send_request(conf, restbase, conf[0].send_request).then(handle_response.bind(this, conf[0].on_response));
	} else if ( Object.keys(conf[0])[0]==="send_request" ) {
		return send_request(conf, restbase, conf[0].send_request);
	} else if (conf[0].return) {
		return res;
	}
}

function handle_response(conf, res) {
	var childHandler;
	for(var condition in conf) {
		if ( match_response(conf[condition], res) ) {
			if (conf[condition].else) {
				childHandler = handle_condition(conf[condition].else, res);
			} else {
				childHandler = handle_condition(conf[condition].then, res);
			}
			break;
		}
	}
	return childHandler;
}

function make_config_handler(restbase) {
	var conf;
	try {
		//TODO: load this properly
        conf = yaml.safeLoad(fs.readFileSync('handler.yml'));
    } catch (e) {
        console.error('Error while reading config file: ' + e);
    }
    
    // fetch uri
    var uri = Object.keys(conf)[0];
    var handler = { uri: {} };

    Object.keys(conf[uri]).forEach(function(item){
		conf = conf[uri][item];
		handler.uri[item] = {};
		if (conf && Object.keys(conf.request_handler[0])[0]==="send_request" && Object.keys(conf.request_handler[0])[1]==="on_response") {
			handler.uri[item].request_handler = function (restbase, req) {
				//console.log(conf, handler);
				return send_request(conf, restbase, req).then(handle_response.bind(this, conf.request_handler[0].on_response));
			};
		} else if (conf && Object.keys(conf.request_handler[0])[0]==="send_request") {
			handler.uri[item].request_handler = function (restbase, req) {
				return send_request(conf, restbase, req);
			};
		1}
    });
    return handler;
}

var handler = make_config_handler(restbase);
handler.uri.GET.request_handler(restbase, { test:"test" });