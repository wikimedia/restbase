'use strict';

// mocha defines to avoid JSHint breakage
/* global describe, it, before, beforeEach, after, afterEach */

var assert = require('../../utils/assert.js');
var server = require('../../utils/server.js');
var preq   = require('preq');

var testPage = {
    title: 'User:GWicke%2F_restbase_test',
    revision: '646859921',
    html: "<!DOCTYPE html>\n<html prefix=\"dc: http://purl.org/dc/terms/ mw: http://mediawiki.org/rdf/\" about=\"http://en.wikipedia.org/wiki/Special:Redirect/revision/646859921\"><head prefix=\"mwr: http://en.wikipedia.org/wiki/Special:Redirect/\"><meta property=\"mw:articleNamespace\" content=\"2\"/><link rel=\"dc:replaces\" resource=\"mwr:revision/0\"/><meta property=\"dc:modified\" content=\"2015-02-12T22:30:30.000Z\"/><meta about=\"mwr:user/11429869\" property=\"dc:title\" content=\"GWicke\"/><link rel=\"dc:contributor\" resource=\"mwr:user/11429869\"/><meta property=\"mw:revisionSHA1\" content=\"6417e5e59b2975e65eebb5104ea572913a61db7e\"/><meta property=\"dc:description\" content=\"selser test page\"/><meta property=\"mw:parsoidVersion\" content=\"0\"/><link rel=\"dc:isVersionOf\" href=\"//en.wikipedia.org/wiki/User%3AGWicke/_restbase_test\"/><title>User:GWicke/_restbase_test</title><base href=\"//en.wikipedia.org/wiki/\"/><link rel=\"stylesheet\" href=\"//en.wikipedia.org/w/load.php?modules=mediawiki.legacy.commonPrint,shared|mediawiki.skinning.elements|mediawiki.skinning.content|mediawiki.skinning.interface|skins.vector.styles|site|mediawiki.skinning.content.parsoid&amp;only=styles&amp;skin=vector\"/></head><body id=\"mwAA\" lang=\"en\" class=\"mw-content-ltr sitedir-ltr ltr mw-body mw-body-content mediawiki\" dir=\"ltr\"><div id=\"bar\">Selser test</div></body></html>",
    wikitext: '<div id=bar>Selser test'
};

describe('transform api', function() {
    this.timeout(20000);

    before(function () { return server.start(); });

    it('html2html', function () {
        return preq.post({
            uri: server.config.baseURL
                + '/transform/html/to/html/' + testPage.title
                + '/' + testPage.revision,
            body: {
                html: testPage.html
            }
        })
        .then(function (res) {
            assert.deepEqual(res.status, 200);
            var pattern = /<div id="bar">Selser test<\/div>/;
            if (!pattern.test(res.body)) {
                throw new Error('Expected pattern in response: ' + pattern
                        + '\nSaw: ' + JSON.stringify(res, null, 2));
            }
            assert.contentType(res, 'text/html;profile=mediawiki.org/specs/html/1.0.0');
        });
    });

    it('html2html with bodyOnly', function () {
        return preq.post({
            uri: server.config.baseURL
                + '/transform/html/to/html/' + testPage.title
                + '/' + testPage.revision,
            body: {
                html: testPage.html,
                bodyOnly: true
            }
        })
        .then(function (res) {
            assert.deepEqual(res.status, 200);
            var pattern = /<div id="bar">Selser test<\/div>/;
            if (!pattern.test(res.body)) {
                throw new Error('Expected pattern in response: ' + pattern
                        + '\nSaw: ' + JSON.stringify(res, null, 2));
            }
            assert.contentType(res, 'text/html;profile=mediawiki.org/specs/html/1.0.0');
        });
    });

    it('wt2html', function () {
        return preq.post({
            uri: server.config.baseURL
                + '/transform/wikitext/to/html/User:GWicke%2F_restbase_test',
            body: {
                wikitext: '== Heading =='
            }
        })
        .then(function (res) {
            assert.deepEqual(res.status, 200);
            assert.contentType(res, 'text/html;profile=mediawiki.org/specs/html/1.0.0');
            var pattern = /<h2.*> Heading <\/h2>/;
            if (!pattern.test(res.body)) {
                throw new Error('Expected pattern in response: ' + pattern
                        + '\nSaw: ' + res.body);
            }
        });
    });

    it('wt2html with bodyOnly', function () {
        return preq.post({
            uri: server.config.baseURL
                + '/transform/wikitext/to/html/User:GWicke%2F_restbase_test',
            body: {
                wikitext: '== Heading ==',
                bodyOnly: true
            }
        })
        .then(function (res) {
            assert.deepEqual(res.status, 200);
            assert.contentType(res, 'text/html;profile=mediawiki.org/specs/html/1.0.0');
            var pattern = /^<h2.*> Heading <\/h2>$/;
            if (!pattern.test(res.body)) {
                throw new Error('Expected pattern in response: ' + pattern
                        + '\nSaw: ' + res.body);
            }
        });
    });


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
            assert.contentType(res, 'text/plain;profile=mediawiki.org/specs/wikitext/1.0.0');
        });
    });

//    it('html2wt, selser', function () {
//        return preq.post({
//            uri: server.config.baseURL
//                + '/transform/html/to/wikitext/' + testPage.title
//                + '/' + testPage.revision,
//            body: {
//                html: testPage.html
//            }
//        })
//        .then(function (res) {
//            assert.deepEqual(res.status, 200);
//            assert.deepEqual(res.body, testPage.wikitext);
//            assert.contentType(res, 'text/plain;profile=mediawiki.org/specs/wikitext/1.0.0');
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
