"use strict";

const assert = require('../utils/assert.js');
const server = require('../utils/server.js');
const preq   = require('preq');

describe('Page Content Service: /data/css/mobile', () => {
    before(() => server.start());

    const commonChecks = (res) => {
        assert.deepEqual(res.status, 200);
        assert.deepEqual(/^text\/css; charset=utf-8/.test(res.headers['content-type']), true);
        assert.deepEqual(!!res.headers.etag, true);
    };

    it('Should get base CSS successfully', () => {
        return preq.get({
            uri: `${server.config.baseURL}/data/css/mobile/base`
        })
        .then((res) => {
            commonChecks(res);
        });
    });

    it('Should get site CSS successfully', () => {
        return preq.get({
            uri: `${server.config.baseURL}/data/css/mobile/site`
        })
        .then((res) => {
            commonChecks(res);
        });
    });
});

