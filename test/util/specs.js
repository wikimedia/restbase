'use strict';

var yaml = require('js-yaml');
var http = require('http');
var template = require('url-template');

function getSpec(url, k) {
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
                            desc: method + ' ' + uri,
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

module.exports.getSpec = getSpec;
module.exports.parseXamples = parseXamples;
