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
    var projectEndpoint = '/pageviews/per-project/en.wikipedia/mobile-app/spider/hourly/2015070100/2015070102';
    var topsEndpoint = '/pageviews/top/en.wikipedia/mobile-web/2015/all-months/all-days';

    // Fake data insertion endpoints
    var insertArticleEndpoint = '/pageviews/insert-per-article/en.wikipedia/desktop/spider/one/daily/2015070200';
    var insertProjectEndpoint = '/pageviews/insert-per-project/en.wikipedia/mobile-app/spider/hourly/2015070101';
    var insertTopsEndpoint = '/pageviews/insert-top/en.wikipedia/mobile-web/2015/all-months/all-days/';

    // Test Article Endpoint

    it('should return empty when no per article data is available', function () {
        return preq.get({
            uri: server.config.baseURL + articleEndpoint
        }).then(function(res) {
            assert.deepEqual(res.body.items.length, 0);
        });
    });

    it('should return the expected per article data after insertion', function () {
        return preq.post({
            uri: server.config.baseURL + insertArticleEndpoint + '/100'
        }).then(function() {
            return preq.get({
                uri: server.config.baseURL + articleEndpoint
            });
        }).then(function(res) {
            assert.deepEqual(res.body.items.length, 1);
            assert.deepEqual(res.body.items[0].views, 100);
        });
    });


    // Test Project Endpoint

    it('should return empty when no per project data is available', function () {
        return preq.get({
            uri: server.config.baseURL + projectEndpoint
        }).then(function(res) {
            assert.deepEqual(res.body.items.length, 0);
        });
    });

    it('should return the expected per project data after insertion', function () {
        return preq.post({
            uri: server.config.baseURL + insertProjectEndpoint + '/1000'
        }).then(function() {
            return preq.get({
                uri: server.config.baseURL + projectEndpoint
            });
        }).then(function(res) {
            assert.deepEqual(res.body.items.length, 1);
            assert.deepEqual(res.body.items[0].views, 1000);
        });
    });


    // Test Top Endpoint

    it('should return empty when no tops data is available', function () {
        return preq.get({
            uri: server.config.baseURL + topsEndpoint
        }).then(function(res) {
            assert.deepEqual(res.body.items.length, 0);
        });
    });

    it('should return the expected tops data after insertion', function () {
        return preq.post({
            uri: server.config.baseURL + insertTopsEndpoint + JSON.stringify([{
                rank: 1,
                article: 'one',
                views: 2000
            }])
        }).then(function() {
            return preq.get({
                uri: server.config.baseURL + topsEndpoint
            });
        }).then(function(res) {
            console.log(res.body);
            assert.deepEqual(res.body.items.length, 1);
            var article = JSON.parse(res.body.items[0].articles)[0];
            assert.deepEqual(article.views, 2000);
        });
    });
});
