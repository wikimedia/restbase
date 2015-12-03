'use strict';

// mocha defines to avoid JSHint breakage
/* global describe, it, before, beforeEach, afterEach */

var assert = require('../../utils/assert.js');
var preq   = require('preq');
var server = require('../../utils/server.js');


describe('pageviews endpoints', function () {
    this.timeout(20000);

    //Start server before running tests
    before(function () { return server.start(); });

    var articleEndpoint = '/metrics/pageviews/per-article/en.wikipedia/desktop/spider/one/daily/20150701/20150703';
    var projectEndpoint = '/metrics/pageviews/aggregate/en.wikipedia/all-access/all-agents/hourly/1969010100/1971010100';
    var topsEndpoint = '/metrics/pageviews/top/en.wikipedia/mobile-web/2015/all-months/all-days';

    // Fake data insertion endpoints
    var insertArticleEndpoint = '/metrics/pageviews/insert-per-article-flat/en.wikipedia/one/daily/2015070200';
    var insertProjectEndpoint = '/metrics/pageviews/insert-aggregate/en.wikipedia/all-access/all-agents/hourly/1970010100';
    var insertProjectEndpointLong = '/metrics/pageviews/insert-aggregate-long/en.wikipedia/all-access/all-agents/hourly/1970010100';
    var insertTopsEndpoint = '/metrics/pageviews/insert-top/en.wikipedia/mobile-web/2015/all-months/all-days';

    function fix(b, s, u) { return b.replace(s, s + u); }
    // Test Article Endpoint

    it('should return 400 when per article parameters are wrong', function () {
        return preq.get({
            uri: server.config.globalURL + articleEndpoint.replace('20150703', '201507a3')
        }).catch(function(res) {
            assert.deepEqual(res.status, 400);
        });
    });

    it('should return the expected per article data after insertion', function () {
        return preq.post({
            // the way we have configured the test insert-per-article endpoint
            // means views_desktop_spider will be 1007 when we pass /100
            uri: server.config.globalURL + insertArticleEndpoint + '/100'
        }).then(function() {
            return preq.get({
                uri: server.config.globalURL + articleEndpoint
            });
        }).then(function(res) {
            assert.deepEqual(res.body.items.length, 1);
            assert.deepEqual(res.body.items[0].views, 1007);
        });
    });


    // Test Project Endpoint

    it('should return 400 when aggregate parameters are wrong', function () {
        return preq.get({
            uri: server.config.globalURL + projectEndpoint.replace('1971010100', '20150701000000')
        }).catch(function(res) {
            assert.deepEqual(res.status, 400);
        });
    });

    it('should return 400 when start is before end', function () {
        return preq.get({
            uri: server.config.globalURL + projectEndpoint.replace('1969010100', '2016070100')
        }).catch(function(res) {
            assert.deepEqual(res.status, 400);
        });
    });

    it('should return 400 when timestamp is invalid', function () {
        return preq.get({
            uri: server.config.globalURL + projectEndpoint.replace('1971010100', '2015022900')
        }).catch(function(res) {
            assert.deepEqual(res.status, 400);
        });
    });

    // WARNING: the data created in this test is used exactly as created
    // by the monitoring tests.
    it('should return the expected aggregate data after insertion', function () {
        return preq.post({
            uri: server.config.globalURL + insertProjectEndpoint + '/0'
        }).then(function() {
            return preq.get({
                uri: server.config.globalURL + projectEndpoint
            });
        }).then(function(res) {
            assert.deepEqual(res.body.items.length, 1);
            assert.deepEqual(res.body.items[0].views, 0);
        });
    });

    it('should return the expected aggregate data after long insertion', function () {
        return preq.post({
            uri: server.config.globalURL +
                 fix(insertProjectEndpointLong, 'en.wikipedia', '1') +
                 '/0'
        }).then(function() {
            return preq.get({
                uri: server.config.globalURL +
                     fix(projectEndpoint, 'en.wikipedia', '1')
            });
        }).then(function(res) {
            assert.deepEqual(res.body.items.length, 1);
            assert.deepEqual(res.body.items[0].views, 0);
        });
    });

    it('should parse the v column string into an int', function () {
        return preq.post({
            uri: server.config.globalURL +
                 fix(insertProjectEndpointLong, 'en.wikipedia', '3') +
                 '/9007199254740991'
        }).then(function() {
            return preq.get({
                uri: server.config.globalURL +
                     fix(projectEndpoint, 'en.wikipedia', '3')
            });
        }).then(function(res) {
            assert.deepEqual(res.body.items.length, 1);
            assert.deepEqual(res.body.items[0].views, 9007199254740991);
        });
    });


    // Test Top Endpoint

    it('should return 400 when tops parameters are wrong', function () {
        return preq.get({
            uri: server.config.globalURL + topsEndpoint.replace('all-months', 'all-monthz')
        }).catch(function(res) {
            assert.deepEqual(res.status, 400);
        });
    });

    it('Should return 400 when all-year is used for the year parameter', function () {
        return preq.get({
            uri: server.config.globalURL + topsEndpoint.replace('2015', 'all-years')
        }).catch(function(res) {
            assert.deepEqual(res.status, 400);
        });
    });

    it('should return 400 when tops date is invalid', function () {
        return preq.get({
            uri: server.config.globalURL + topsEndpoint.replace('all-months/all-days', '02/29')
        }).catch(function(res) {
            assert.deepEqual(res.status, 400);
        });
    });

    it('should return 400 when tops parameters are using "all-months" wrong', function () {
        return preq.get({
            uri: server.config.globalURL + topsEndpoint.replace('all-days', '01')
        }).catch(function(res) {
            assert.deepEqual(res.status, 400);
        });
    });

    it('should return the expected tops data after insertion', function () {
        return preq.post({
            uri: server.config.globalURL + insertTopsEndpoint,
            body: {
                articles: [{
                        rank: 1,
                        article: 'o"n"e',
                        views: 2000
                    },{
                        rank: 2,
                        article: 'two\\',
                        views: 1000
                    }
                ]
            },
            headers: { 'content-type': 'application/json' }

        }).then(function() {
            return preq.get({
                uri: server.config.globalURL + topsEndpoint
            });
        }).then(function(res) {
            assert.deepEqual(res.body.items.length, 1);
            assert.deepEqual(res.body.items[0].articles[0].article, 'o"n"e');
            assert.deepEqual(res.body.items[0].articles[1].views, 1000);
            assert.deepEqual(res.body.items[0].articles[1].article, 'two\\');
        });
    });
});
