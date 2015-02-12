'use strict';

// mocha defines to avoid JSHint breakage
/* global describe, it, before, beforeEach, after, afterEach */

var assert = require('../../../utils/assert.js');
var server = require('../../../utils/server.js');
var preq   = require('preq');
var fs     = require('fs');

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

function x2y(spec) {
    function test() {
        return preq.post({
            uri: server.config.baseURL + '/transform/' + spec.from.format + '/to/' + spec.to.format,
			headers: {
				'content-type': /\.html$/.test(spec.from.src) ?
					'text/html' : 'application/json'
			},
            body: {
				// FIXME: use format name
				content: readFile(spec.from.src)
			}
        })
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

describe('transform api', function() {
    this.timeout(20000);

    before(function () { return server.start(); });

    it('html2wt, no-selser', function () {
        return preq.post({
			uri: server.config.baseURL
				+ '/transform/html/to/wikitext/User:GWicke%2F_restbase_test',
            body: {
				html: '<body>The modified HTML</body>'
            }
        })
        .then(function (res) {
            assert.deepEqual(res.status, 200);
            assert.deepEqual(res.body, 'The modified HTML');
			assert.deepEqual(res.headers['content-type'],
					'text/plain;profile=mediawiki.org/specs/wikitext/1.0.0');
        });
    });

//    it('html2wt, selser', function () {
//        return preq.post({
//			uri: server.config.baseURL
//				+ '/transform/html/to/wikitext/User:GWicke%2F_restbase_test/646859921',
//            body: {
//				html: "<!DOCTYPE html>\n<html prefix=\"dc: http://purl.org/dc/terms/ mw: http://mediawiki.org/rdf/\" about=\"http://en.wikipedia.org/wiki/Special:Redirect/revision/646859921\"><head prefix=\"mwr: http://en.wikipedia.org/wiki/Special:Redirect/\"><meta property=\"mw:articleNamespace\" content=\"2\"/><link rel=\"dc:replaces\" resource=\"mwr:revision/0\"/><meta property=\"dc:modified\" content=\"2015-02-12T22:30:30.000Z\"/><meta about=\"mwr:user/11429869\" property=\"dc:title\" content=\"GWicke\"/><link rel=\"dc:contributor\" resource=\"mwr:user/11429869\"/><meta property=\"mw:revisionSHA1\" content=\"6417e5e59b2975e65eebb5104ea572913a61db7e\"/><meta property=\"dc:description\" content=\"selser test page\"/><meta property=\"mw:parsoidVersion\" content=\"0\"/><link rel=\"dc:isVersionOf\" href=\"//en.wikipedia.org/wiki/User%3AGWicke/_restbase_test\"/><title>User:GWicke/_restbase_test</title><base href=\"//en.wikipedia.org/wiki/\"/><link rel=\"stylesheet\" href=\"//en.wikipedia.org/w/load.php?modules=mediawiki.legacy.commonPrint,shared|mediawiki.skinning.elements|mediawiki.skinning.content|mediawiki.skinning.interface|skins.vector.styles|site|mediawiki.skinning.content.parsoid&amp;only=styles&amp;skin=vector\"/></head><body id=\"mwAA\" lang=\"en\" class=\"mw-content-ltr sitedir-ltr ltr mw-body mw-body-content mediawiki\" dir=\"ltr\"><div id=\"bar\">Selser test</div></body></html>"
//            }
//        })
//        .then(function (res) {
//            assert.deepEqual(res.status, 200);
//            assert.deepEqual(res.body, '<div id=bar>Selser test');
//			assert.deepEqual(res.headers['content-type'],
//					'text/plain;profile=mediawiki.org/specs/wikitext/1.0.0');
//        });
//    });

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
