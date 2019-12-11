'use strict';

const assert = require('../utils/assert.js');
const Server = require('../utils/server.js');
const preq   = require('preq');

describe('Page Related', () => {

    const server = new Server();
    before(() => server.start());
    after(() => server.stop());

    it('retrieve correct displaytitle for language variants', () => {
        const uri = `${server.config.bucketURL('zh.wikipedia.beta.wmflabs.org')}/related/%E5%8D%97%E5%8C%97%E6%9C%9D`;
        return preq.get({
            uri,
            headers: {
                'accept-language': 'zh-hant',
            }
        }).then((res) => {
            assert.deepEqual(res.status, 200);
            assert.ok(Array.isArray(res.body.pages));
            assert.deepEqual(res.body.pages[0].displaytitle, '首頁');
            assert.deepEqual(res.headers['content-language'], 'zh-hant');
            assert.ok(res.headers['vary'].includes('accept-language'));
        });
    })

})