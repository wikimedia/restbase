"use strict";

var fs = Promise.promisifyAll(require('fs'));
var path = require('path');

var docRoot = __dirname + '/../node_modules/swagger-ui/dist/';
function staticServe (restbase, req) {
    // Expand any relative paths for security
    var filePath = req.query.path.replace(/\.\.\//g, '');
    return fs.readFileAsync(docRoot + filePath, 'utf8')
    .then(function(body) {
        if (filePath === '/index.html') {
            // Rewrite the HTML to use a query string
            body = body.replace(/((?:src|href)=['"])/g, '$1?doc=&path=')
                // Replace the default url with ours
                .replace(/url = "http/, 'url = "?spec"; //');
        }

        var contentType = 'text/html';
        if (/\.js$/.test(filePath)) {
            contentType = 'text/javascript';
        } else if (/\.png/.test(filePath)) {
            contentType = 'image/png';
        } else if (/\.css/.test(filePath)) {
            contentType = 'text/css';
            body = body.replace(/\.\.\/(images|fonts)\//g, '?doc&path=$1/');
        }
        return Promise.resolve({
            status: 200,
            headers: {
                'content-type': contentType,
            },
            body: body
        });
    });
}


module.exports = staticServe;

