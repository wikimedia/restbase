"use strict";

var P = require('bluebird');
var fs = P.promisifyAll(require('fs'));
var path = require('path');
// Swagger-ui helpfully exports the absolute path of its dist directory
var docRoot = require('swagger-ui').dist + '/';

function staticServe(restbase, req) {
    // Expand any relative paths for security
    var filePath = req.query.path.replace(/\.\.\//g, '');
    return fs.readFileAsync(docRoot + filePath, 'utf8')
    .then(function(body) {
        if (filePath === '/index.html') {
            // Rewrite the HTML to use a query string
            body = body.replace(/((?:src|href)=['"])/g, '$1?doc=&path=')
                // Some self-promotion
                .replace(/<a id="logo".*?<\/a>/,
                        '<a id="logo" href="https://www.mediawiki.org/wiki/RESTBase">RESTBase</a>')
                .replace(/<title>[^<]*<\/title>/,
                        '<title>RESTBase docs</title>')
                // Replace the default url with ours, switch off validation &
                // limit the size of documents to apply syntax highlighting to
                .replace(/Sorter: "alpha"/, 'Sorter: "alpha", ' + 'validatorUrl: null, ' +
                    'highlightSizeThreshold: 10000, docExpansion: "list"')
                .replace(/ url: url,/, 'url: "?spec",');
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
        return P.resolve({
            status: 200,
            headers: {
                'content-type': contentType,
                'content-security-policy': "default-src 'none'; " +
                    "script-src 'self' 'unsafe-inline'; connect-src 'self'; " +
                    "style-src 'self' 'unsafe-inline'; img-src 'self'; font-src 'self';"
            },
            body: body
        });
    });
}


module.exports = staticServe;
