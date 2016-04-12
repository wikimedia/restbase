"use strict";

var assert = require('../utils/assert.js');
var server = require('../utils/server.js');
var preq   = require('preq');

describe('Metrics', function() {
    this.timeout(20000);

    before(function () { return server.start(); });

    it('Should get page views per page', function() {
        return preq.get({
            uri: server.config.globalURL
                + '/metrics/pageviews/per-article/en.wikipedia/all-access/all-agents/Main_Page/daily/2016010100/2016010100'
        })
        .then(function(res) {
            assert.deepEqual(res.status, 200);
            assert.deepEqual(res.headers['content-type'], 'application/json; charset=utf-8');
            assert.deepEqual(res.body, {
                items: [
                    {
                        project: 'en.wikipedia',
                        article: 'Main_Page',
                        access: 'all-access',
                        agent: 'all-agents',
                        granularity: 'daily',
                        timestamp: '2016010100',
                        views: 16357307
                    }
                ]
            });
        });
    });

    it('Should get top articles', function() {
        return preq.get({
            uri: server.config.globalURL
                + '/metrics/pageviews/top/en.wikipedia/all-access/2016/01/01'
        })
        .then(function(res) {
            assert.deepEqual(res.status, 200);
            assert.deepEqual(res.headers['content-type'], 'application/json; charset=utf-8');
            // The response body is too big to compare, so just check the response status.
        });
    });
});