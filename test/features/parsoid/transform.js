'use strict';

// mocha defines to avoid JSHint breakage
/* global describe, it, before, beforeEach, after, afterEach */

var assert = require('../../utils/assert.js');
var server = require('../../utils/server.js');
var preq   = require('preq');

var testPage = {
    title: 'User:GWicke%2F_restbase_test',
    revision: '646859921',
    wikitext: '<div id=bar>Selser test'
    // html is fetched dynamically
};

describe('transform api', function() {
    this.timeout(20000);

    before(function () {
        return server.start()
        .then(function() {
            return preq.get({
                uri: server.config.baseURL
                    + '/page/html/' + testPage.title
                    + '/' + testPage.revision,
            });
        })
        .then(function (res) {
            testPage.html = res.body;
        });
    });

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

    it('html2wt, selser', function () {
        return preq.post({
            uri: server.config.baseURL
                + '/transform/html/to/wikitext/' + testPage.title
                + '/' + testPage.revision,
            body: {
                html: testPage.html
            }
        })
        .then(function (res) {
            assert.deepEqual(res.status, 200);
            assert.deepEqual(res.body, testPage.wikitext);
            assert.contentType(res, 'text/plain;profile=mediawiki.org/specs/wikitext/1.0.0');
        });
    });

    it('sections2wt, replace', function() {
        var pageWithSectionsTitle = 'User:Pchelolo',
            pageWithSectionsRev = 669197670;
        return preq.post({
            uri: server.config.baseURL
                + '/transform/sections/to/wikitext/'
                + pageWithSectionsTitle
                + '/' + pageWithSectionsRev,
            body: {
                sections: '{"mwAQ":"<h2>First section replaced</h2>",'
                    + '"mwAg":"<h2>Second section replaced</h2>"}'
            }
        })
        .then(function(res) {
            assert.deepEqual(res.status, 200);
            assert.contentType(res, 'text/plain;profile=mediawiki.org/specs/wikitext/1.0.0');
            assert.deepEqual(/== First section replaced ==/.test(res.body), true);
            assert.deepEqual(/== Second section replaced ==/.test(res.body), true);
        });
    });

    it('sections2wt, append', function() {
        var pageWithSectionsTitle = 'User:Pchelolo',
            pageWithSectionsRev = 669197670;
        return preq.post({
            uri: server.config.baseURL
                + '/transform/sections/to/wikitext/'
                + pageWithSectionsTitle
                + '/' + pageWithSectionsRev,
            body: {
                sections: '{"mwAQ":"<h2>First section replaced</h2><h2>Appended section</h2>"}'
            }
        })
        .then(function(res) {
            assert.deepEqual(res.status, 200);
            assert.contentType(res, 'text/plain;profile=mediawiki.org/specs/wikitext/1.0.0');
            assert.deepEqual(/== Appended section ==/.test(res.body), true);
            assert.deepEqual(/== Second section ==/.test(res.body), true);
        });
    });
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
