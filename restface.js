var fs = require('fs'),
	path = require('path'),
	prfun = require('prfun'),
	readdir = Promise.promisify(fs.readdir),
	log = function (level, msg) {
		if (/^error/.test(level)) {
			console.error(msg);
		} else {
			console.log(msg);
		}
	};

function* loadHandlers () {
	var handlerNames = yield readdir('./handlers'),
		handlers = [];
	handlerNames.forEach(function(handlerName) {
		try {
			handlers.push(require(path.resolve('./handlers/' + handlerName)));
		} catch (e) {
			log('error/handler', e, handlerName);
		}
	});
	return handlers;
}

Promise.async(loadHandlers)()
.then(function(handlers) {
	console.log(handlers);
});
