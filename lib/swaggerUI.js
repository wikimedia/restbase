"use strict";

var P = require('bluebird');
var fs = P.promisifyAll(require('fs'));
var path = require('path');
// Swagger-ui helpfully exports the absolute path of its dist directory
var docRoot = require('swagger-ui').dist + '/';
var HTTPError = require('./exports').HTTPError;

function staticServe(hyper, req) {
    var reqPath = req.query.path;

    var filePath = path.join(docRoot, reqPath);

    // Disallow relative paths.
    // Test relies on docRoot ending on a slash.
    if (filePath.substring(0, docRoot.length) !== docRoot) {
        throw new Error("Invalid path.");
    }

    return fs.readFileAsync(filePath, 'utf8')
    .then(function(body) {
        if (reqPath === '/index.html') {
            // Rewrite the HTML to use a query string
            body = body.replace(/((?:src|href)=['"])/g, '$1?doc=&path=')
                // Some self-promotion
                .replace(/<a id="logo".*?<\/a>/,
                        '<a id="logo" href="https://www.mediawiki.org/wiki/RESTBase">RESTBase</a>')
                .replace(/<title>[^<]*<\/title>/,
                        '<title>RESTBase docs</title>') // TODO: Make this configurable
                // Replace the default url with ours, switch off validation &
                // limit the size of documents to apply syntax highlighting to
                .replace(/Sorter: "alpha"/, 'Sorter: "alpha", ' + 'validatorUrl: null, ' +
                    'highlightSizeThreshold: 10000, docExpansion: "list"')
                .replace(/ url: url,/, 'url: "?spec",');
        }

        var contentType = 'text/html';
        if (/\.js$/.test(reqPath)) {
            contentType = 'text/javascript';
            body = body.replace(/underscore\-min\.map/, '?doc=&path=lib/underscore-min.map');
        } else if (/\.png/.test(reqPath)) {
            contentType = 'image/png';
        } else if (/\.map$/.test(reqPath)) {
            contentType = 'application/json';
        } else if (/\.css/.test(reqPath)) {
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
    })
    .catch(function(e) {
        if (e && e.code === 'ENOENT') {
            return new HTTPError({
                status: 404,
                body: {
                    type: 'not_found',
                    title: 'Not found.',
                }
            });
        } else {
            throw e;
        }
    });
}


module.exports = staticServe;
