'use strict';

// mocha defines to avoid JSHint breakage
/* global describe, it, before, beforeEach, after, afterEach */

var assert = require('../../utils/assert.js');
var preq   = require('preq');
var fs     = require('fs');
var server = require('../../utils/server.js');

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
    var specDirPattern = /^(.+)2([^_]+)(_\w+)?$/;
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

function x2y(spec) {

    function makeReq(filename) {
        var req = {
          uri: server.config.baseURL + '/transform/' + spec.from.format +
               '/to/' + spec.to.format,
        };
        if (/\.json$/.test(filename)) {
            req.headers = { 'content-type': 'application/json' };
            req.body = readFile(spec.from.src);
        } else if (/\.html$/.test(filename)) {
            req.headers = {
              'content-type': 'multipart/form-data; ' +
                              'boundary=------------------------90ff8390568074be'
            };
            req.body = '--------------------------90ff8390568074be\n' +
                       '\n' +
                       'Content-Disposition: form-data; name="html"\n' +
                       '\n' +
                       'Content-Type: text/html\n' +
                       '\n' +
                       '\n' +
                       '\n' +
                       readFile(spec.from.src) + '\n' +
                       '\n' +
                       '--------------------------90ff8390568074be--\n';
        }
        return req;
    }

    function test() {
        return preq.post(makeReq(spec.from.src))
        .then(function(res) {
            assert.deepEqual(res.status, 200);
            assert.deepEqual(res.body, readFile(spec.to.src));
        });
    }
    describe('transform api: ' + spec.name, function() {
        this.timeout(20000);
        before(function () { return server.start(); });
        it('should directly convert ' + spec.from.format + ' to ' + spec.to.format, test);
    });
}
   
findSpecs().forEach(function (spec) {
    x2y(spec);
});

/* TODO: actually implement wikitext fetching
describe('storage-backed transform api', function() {
    this.timeout(20000);

    before(function () { return server.start(); });

    it('should load a specific title/revision from storage to send as the "original"', function () {
        return preq.post({
            uri: server.config.baseURL + '/transform/html/to/wikitext/Main_Page/1',
            headers: { 'content-type': 'application/json' },
            body: {
                headers: {
                  'content-type': 'text/html;profile=mediawiki.org/specs/html/1.0.0'
                },
                body: '<html>The modified HTML</html>'
            }
        })
        .then(function (res) {
            assert.deepEqual(res.status, 200);
            assert.deepEqual(res.body, {
                wikitext: {
                    headers: {
                        'content-type': 'text/plain;profile=mediawiki.org/specs/wikitext/1.0.0'
                    },
                    body: 'The modified HTML'
                }
            });
        });
    });

});
*/
