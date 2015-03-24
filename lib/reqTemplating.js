'use strict';

var yaml = require('js-yaml'),
    fs = require('fs'),
    preq = require('preq'),
    template = require('url-template');

function _assemble(spec) {
    var traverse = function(path, key) {
        // A simple dotted path reference
        var code = "req"
        path.split(/\./).forEach(function(pathBit, index) {
            if (index) {
                code += "['"+JSON.stringify(pathBit).replace(/\"/g, "")+"']";
            }
        });
        return "newReq['"+JSON.stringify(key).replace(/\"/g, "")+"'] = "+code+";";
    };
    var code = [];
    if (spec === "$request") {
        code.push("return req");
    } else {
        code.push("var newReq = {};");
        for (var key in spec) {
            // a variable reference
            if (/^\$/.test(spec[key])) {
                code.push(traverse(spec[key].slice(1), key));
            } else if (/^\{[^}]+\}$/.test(spec[key])) {
                var groups = /^\{([^}]+)\}$/.exec(spec[key]);
                code.push(traverse(groups[1], key));
            } else if (!/^\//.test(spec[key])) {
                // Skip URI template                
                // Treat it as a string literal
                code.push("newReq['"+JSON.stringify(key).replace(/\"/g, "")+"'] = "+JSON.stringify(spec[key])+";");
            }
        }
        code.push("return newReq;")
    }
    return code.join('\n');
};

var eval_request = function(spec) {
    var code = _assemble(spec);
    try {
        var fn = new Function ('req', code);
        return fn;
    } catch (err) {
        console.error(err);
    }
};

module.exports = eval_request;