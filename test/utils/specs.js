'use strict';

var HyperSwitch = require('hyperswitch');
var yaml = require('js-yaml');
var http = require('http');

var specUrl = 'http://wikimedia.github.io/restbase/v1/swagger.yaml';

function getLocalSpec() {
    return HyperSwitch.utils.loadSpec(__dirname + '/../features/specification/swagger.yaml');
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

// TODO: switch this to getRemoteSpec() prior to v1 release
module.exports.get = getLocalSpec;
