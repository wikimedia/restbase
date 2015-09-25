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

    var contentTypes = server.config.conf.test.content_types;

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
            assert.contentType(res, contentTypes.html);
        });
    });

    it('html2html with body_only', function () {
        return preq.post({
            uri: server.config.baseURL
                + '/transform/html/to/html/' + testPage.title
                + '/' + testPage.revision,
            body: {
                html: testPage.html,
                body_only: true
            }
        })
        .then(function (res) {
            assert.deepEqual(res.status, 200);
            var pattern = /<div id="bar">Selser test<\/div>/;
            if (!pattern.test(res.body)) {
                throw new Error('Expected pattern in response: ' + pattern
                        + '\nSaw: ' + JSON.stringify(res, null, 2));
            }
            assert.contentType(res, contentTypes.html);
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
            assert.contentType(res, contentTypes.html);
            var pattern = /<h2.*> Heading <\/h2>/;
            if (!pattern.test(res.body)) {
                throw new Error('Expected pattern in response: ' + pattern
                        + '\nSaw: ' + res.body);
            }
        });
    });

    it('wt2html with body_only', function () {
        return preq.post({
            uri: server.config.baseURL
                + '/transform/wikitext/to/html/User:GWicke%2F_restbase_test',
            body: {
                wikitext: '== Heading ==',
                body_only: true
            }
        })
        .then(function (res) {
            assert.deepEqual(res.status, 200);
            assert.contentType(res, contentTypes.html);
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
            assert.contentType(res, contentTypes.wikitext);
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
            assert.contentType(res, contentTypes.wikitext);
        });
    });

    it('sections2wt, replace', function() {
        var pageWithSectionsTitle = 'User:Pchelolo%2Fsections_test';
        var pageWithSectionsRev = 669458404;
        return preq.post({
            uri: server.config.baseURL
                + '/transform/sections/to/wikitext/'
                + pageWithSectionsTitle
                + '/' + pageWithSectionsRev,
            body: {
                sections: '{"mwAg":"<h2>First Section replaced</h2>",'
                    + '"mwAw":"<h2>Second Section replaced</h2>"}'
            }
        })
        .then(function(res) {
            assert.deepEqual(res.status, 200);
            assert.contentType(res, contentTypes.wikitext);
            assert.deepEqual(/== First Section ==/.test(res.body), false);
            assert.deepEqual(/== Second Section ==/.test(res.body), false);
            assert.deepEqual(/== First Section replaced ==/.test(res.body), true);
            assert.deepEqual(/== Second Section replaced ==/.test(res.body), true);
        });
    });

    it('sections2wt, append', function() {
        var pageWithSectionsTitle = 'User:Pchelolo%2Fsections_test';
        var pageWithSectionsRev = 669458404;
        return preq.post({
            uri: server.config.baseURL
                + '/transform/sections/to/wikitext/'
                + pageWithSectionsTitle
                + '/' + pageWithSectionsRev,
            body: {
                sections: '{"mwAg":"<h2>First Section replaced</h2><h2>Appended Section</h2>"}'
            }
        })
        .then(function(res) {
            assert.deepEqual(res.status, 200);
            assert.contentType(res, contentTypes.wikitext);
            assert.deepEqual(/== First Section ==/.test(res.body), false);
            assert.deepEqual(/== First Section replaced ==/.test(res.body), true);
            assert.deepEqual(/== Appended Section ==/.test(res.body), true);
            assert.deepEqual(/== Second Section ==/.test(res.body), true);
        });
    });

    it('sections2wt, append, application/json', function() {
        var pageWithSectionsTitle = 'User:Pchelolo%2Fsections_test';
        var pageWithSectionsRev = 669458404;
        return preq.post({
            uri: server.config.baseURL
                + '/transform/sections/to/wikitext/'
                + pageWithSectionsTitle
                + '/' + pageWithSectionsRev,
            body: {
                sections: {
                    'mwAg':'<h2>First Section replaced</h2><h2>Appended Section</h2>'
                }
            },
            headers: {
                'content-type': 'application/json'
            }
        })
        .then(function(res) {
            assert.deepEqual(res.status, 200);
            assert.contentType(res, contentTypes.wikitext);
            assert.deepEqual(/== First Section ==/.test(res.body), false);
            assert.deepEqual(/== First Section replaced ==/.test(res.body), true);
            assert.deepEqual(/== Appended Section ==/.test(res.body), true);
            assert.deepEqual(/== Second Section ==/.test(res.body), true);
        });
    });

    it('passes scrubWikitext parameter', function() {
        return preq.post({
            uri: server.config.baseURL + '/transform/html/to/wikitext',
            body: {
                html: '<h2></h2>',
                scrubWikitext: 1
            }
        })
        .then(function(res) {
            assert.deepEqual(res.status, 200);
            assert.deepEqual(res.body, '');
        });
    });

    it('returns 409 if revision was restricted while edit happened', function() {
        var badPageName = 'User_talk:DivineAlpha%2fQ1_2015_discussions';
        var badRevNumber = 645504917;
        return preq.post({
            uri: server.config.baseURL
                + '/transform/html/to/wikitext/' + badPageName + '/' + badRevNumber,
            body: {
                html: '<html><head>' +
                    '<meta property="mw:TimeUuid" content="71966eaf-62cd-11e5-8a88-952fdaad0387"/>' +
                    '</head><body></body></html>'
            }
        })
        .then(function() {
            throw new Error('Error should be thrown');
        }, function(e) {
            assert.deepEqual(e.status, 409);
        })
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
                  'content-type': 'text/html;profile="mediawiki.org/specs/html/1.0.0"'
                },
                body: '<html>The modified HTML</html>'
            }
        })
        .then(function (res) {
            assert.deepEqual(res.status, 200);
            assert.deepEqual(res.body, {
                wikitext: {
                    headers: {
                        'content-type': 'text/plain;profile="mediawiki.org/specs/wikitext/1.0.0"'
                    },
                    body: 'The modified HTML'
                }
            });
        });
    });

});
*/
