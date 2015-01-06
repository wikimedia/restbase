'use strict';

// mocha defines to avoid JSHint breakage
/* global describe, it, before, beforeEach, after, afterEach */

var assert = require('../../utils/assert.js');
var preq = require('preq');
var fs = require('fs');

// read the contents of a spec file as JSON or raw HTML
function readFile(filename) {
    var contents = fs.readFileSync(filename, { encoding: 'utf8' });

    // readFileSync seems to append a line feed
    contents = contents.replace(/\n$/, "");

    if (/\.json$/.test(filename)) {
        return JSON.parse(contents);
    } else {
        return contents;
    }
}

// find dirs matching the pattern "{foo}2{bar}"
function findSpecDirs() {
    var specDirs = [];
    var specDirPattern = /^(.+)2(.+)$/;
    function isDir(x) {
        return fs.statSync(x).isDirectory();
    }
    function isSpecDir(x) {
        return isDir(__dirname + '/' + x) && specDirPattern.test(x);
    }
    var dirs = fs.readdirSync(__dirname);
    dirs.forEach(function(dir) {
        if (isSpecDir(dir)) {
            var match = specDirPattern.exec(dir);
            var fromFormat = match[1];
            var toFormat = match[2];
            specDirs.push({
                name: fromFormat + '2' + toFormat,
                fromFormat: fromFormat,
                toFormat: toFormat,
                src: __dirname + '/' + dir
            });
        }
    });
    return specDirs;
}

// for each dir that looks like it contains req/res specs, find the specs
function findSpecs() {
    var specs = [];
    findSpecDirs().forEach(function (specDir) {
        var files = fs.readdirSync(specDir.src);
        var request = null;
        var response = null;
        files.forEach(function(file2) {
            if (/^request\./.test(file2)) {
                request = specDir.src + '/' + file2;
            } else if (/^response\./.test(file2)) {
                response = specDir.src + '/' + file2;
            }
        });
        if (request !== null && response !== null) {
            specs.push({
                name: specDir.name,
                from: { format: specDir.fromFormat, src: request },
                to: { format: specDir.toFormat, src: response }
            });
        }
       
    });
    return specs;
}

module.exports = function (config) {
    function x2y(spec) {
        function test() {
            return preq.post({
                uri: config.baseURL + '/transform/' + spec.from.format + '/to/' + spec.to.format,
                headers: { 'content-type': 'application/json' },
                body: readFile(spec.from.src)
            })
            .then(function(res) {
                assert.deepEqual(res.status, 200);
                assert.deepEqual(res.body, readFile(spec.to.src));
            });
        }
        describe(spec.name, function() {
            it('should directly convert ' + spec.from.format + ' to ' + spec.to.format, test);
        });
    }
   
    findSpecs().forEach(function (spec) {
        x2y(spec);
    });

};
