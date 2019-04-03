'use strict';

const HyperSwitch = require('hyperswitch');
const yaml = require('js-yaml');
const http = require('http');

const specUrl = 'http://wikimedia.github.io/restbase/v1/swagger.yaml';

function getLocalSpec() {
    return HyperSwitch.utils.loadSpec(`${__dirname}/../features/specification/swagger.yaml`);
}

function getRemoteSpec(url, k) {
    const buffer = [];
    http.get(url, (response) => {
        response.setEncoding('utf8');
        response.on('data', (data) => { buffer.push(data); });
        response.on('error', console.error);
        response.on('end', () => {
            k(yaml.safeLoad(buffer.join('')));
        });
    });
}

// TODO: switch this to getRemoteSpec() prior to v1 release
module.exports.get = getLocalSpec;
