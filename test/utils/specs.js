'use strict';

var yaml = require('js-yaml');
var http = require('http');
var template = require('url-template');
var fs = require('fs');

var specUrl = 'http://wikimedia.github.io/restbase/v1/swagger.yaml';

function getLocalSpec() {
    var buffer = fs.readFileSync(__dirname + '/../features/specification/swagger.yaml');
    return yaml.safeLoad(buffer);
}

function getRemoteSpec(url, k) {
    var buffer = [];
    http.get(url, function (response) {
        response.setEncoding('utf8');
        response.on('data', function (data) { buffer.push(data); });
        response.on('error', console.error);
        response.on('end', function () {
            k(yaml.safeLoad(buffer.join('')));
        });
    });
}

function parseXamples(spec, host) {
    var xamples = [];
    if (spec.paths) {
        for (var uri in spec.paths) {
            var path = spec.paths[uri];
            for (var method in path) {
                var operation = path[method];
                if (operation['x-amples']) {
                    operation['x-amples'].forEach(function (xample) {
                        var prereqs = [];
                        if (xample.prerequisites) {
                            xample.prerequisites.forEach(function(prereq) {
                                prereq.uri = host + prereq.uri;
                                prereqs.push(prereq);
                            });
                        }
                        var uriTemplate = template.parse(uri);
                        var expandedUri = uriTemplate.expand(xample.request.params);
                        xample.request.method = method;
                        xample.request.uri = host + spec.basePath + expandedUri;
                        xamples.push({
                            description: method + ' ' + uri,
                            prereqs: prereqs,
                            request: xample.request,
                            response: xample.response
                        });
                    });
                }
            }
        }
    }
    return xamples;
}

module.exports.parseXamples = parseXamples;

// TODO: switch this to getRemoteSpec() prior to v1 release
module.exports.get = getLocalSpec;
