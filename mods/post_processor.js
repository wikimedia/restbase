"use strict";

var yaml = require('js-yaml');
var fs = require('fs');
var spec = yaml.safeLoad(fs.readFileSync(__dirname + '/post_processor.yaml'));

var contentType = require('content-type');

function PostProcessor(options) {
    this.log = options.log || function() {};
    this.contentTypeCache = {};
}

PostProcessor.prototype.validateMimeType = function(restbase, req) {
    var specContentType = this.contentTypeCache[req.body.spec.produces[0]];
    if (!specContentType) {
        specContentType = contentType.parse(req.body.spec.produces[0]);
        this.contentTypeCache[req.body.spec.produces[0]] = specContentType;
    }

    var resContentType = this.contentTypeCache[req.body.original_res.headers['content-type']];
    if (!resContentType) {
        resContentType = contentType.parse(req.body.original_res.headers['content-type']);
        this.contentTypeCache[req.body.original_res.headers['content-type']] = resContentType;
    }

    return req.body.original_res;
};

module.exports = function(options) {
    var postProcessor = new PostProcessor(options);

    return {
        spec: spec, // Re-export from spec module
        operations: {
            validateMimeType: postProcessor.validateMimeType.bind(postProcessor)
        }
    };
};