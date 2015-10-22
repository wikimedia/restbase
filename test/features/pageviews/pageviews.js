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

    var articleEndpoint = '/pageviews/per-article/en.wikipedia/desktop/spider/one/daily/2015070100/2015070300';
    var projectEndpoint = '/pageviews/aggregate/en.wikipedia/all-access/all-agents/hourly/1969010100/1971010100';
    var topsEndpoint = '/pageviews/top/en.wikipedia/mobile-web/2015/all-months/all-days';

    // Fake data insertion endpoints
    // TODO: replace the following line with this after we switch to the flat table: var insertArticleEndpoint = '/pageviews/insert-per-article-flat/en.wikipedia/one/daily/2015070200';
    var insertArticleEndpoint = '/pageviews/insert-per-article/en.wikipedia/desktop/spider/one/daily/2015070200';
    var insertProjectEndpoint = '/pageviews/insert-aggregate/en.wikipedia/all-access/all-agents/hourly/1970010100';
    var insertTopsEndpoint = '/pageviews/insert-top/en.wikipedia/mobile-web/2015/all-months/all-days/';

    // Test Article Endpoint

    it('should return 400 when per article parameters are wrong', function () {
        return preq.get({
            uri: server.config.globalURL + articleEndpoint.replace('2015070300', '201507a300')
        }).catch(function(res) {
            assert.deepEqual(res.status, 400);
        });
    });

    /*
     * TODO: Replace the following test with this one when we switch to the flat table
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
    */

    it('should return the expected per article data after insertion', function () {
        return preq.post({
            uri: server.config.globalURL + insertArticleEndpoint + '/100'
        }).then(function() {
            return preq.get({
                uri: server.config.globalURL + articleEndpoint
            });
        }).then(function(res) {
            assert.deepEqual(res.body.items.length, 1);
            assert.deepEqual(res.body.items[0].views, 100);
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


    // Test Top Endpoint

    it('should return 400 when tops parameters are wrong', function () {
        return preq.get({
            uri: server.config.globalURL + topsEndpoint.replace('all-months', 'all-monthz')
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
            uri: server.config.globalURL + insertTopsEndpoint + JSON.stringify([{
                rank: 1,
                article: 'one',
                views: 2000
            }])
        }).then(function() {
            return preq.get({
                uri: server.config.globalURL + topsEndpoint
            });
        }).then(function(res) {
            assert.deepEqual(res.body.items.length, 1);
            var article = JSON.parse(res.body.items[0].articles)[0];
            assert.deepEqual(article.views, 2000);
        });
    });
});
