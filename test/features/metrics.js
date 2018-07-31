'use strict';

/* global it, before */

const assert = require('../utils/assert.js');
const server = require('../utils/server.js');
const preq   = require('preq');
const parallel = require('mocha.parallel');

parallel('Metrics', function() {
    this.timeout(20000);

    before(() => { return server.start(); });

    it('Should get page views per page', () => {
        return preq.get({
            uri: `${server.config.globalURL}/metrics/pageviews/per-article/en.wikipedia/all-access/all-agents/Main_Page/daily/2016010100/2016010100`
        })
        .then((res) => {
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

    it('Should get top articles', () => {
        return preq.get({
            uri: `${server.config.globalURL}/metrics/pageviews/top/en.wikipedia/all-access/2016/01/01`
        })
        .then((res) => {
            assert.deepEqual(res.status, 200);
            assert.deepEqual(res.headers['content-type'], 'application/json; charset=utf-8');
            // The response body is too big to compare, so just check the response status.
        });
    });
});
