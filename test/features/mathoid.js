'use strict';

const assert = require('../utils/assert.js');
const Server = require('../utils/server.js');
const preq   = require('preq');

describe('Mathoid', function() {
    this.timeout(20000);
    const server = new Server();
    const f = 'c^2 = a^2 + b^2';
    const nf = 'c^{2}=a^{2}+b^{2}';
    const formats = ['mml', 'svg'];
    const formatRegexp = [/mathml/, /svg/];
    let hash;

    before(() => server.start());
    after(() => server.stop());

    it('checks the formula with Mathoid', () => {
        assert.recordRequests();
        return preq.post({
            uri: `${server.config.baseURL('wikimedia.org')}/media/math/check/tex`,
            headers: { 'content-type': 'application/json' },
            body: { q: f }
        }).then((res) => {
            hash = res.headers['x-resource-location'];
            assert.remoteRequests(true);
            assert.checkString(res.headers['cache-control'], 'no-cache');
        })
        .finally(() => assert.cleanupRecorder());
    });

    it('retrieves the check output from storage', () => {
        assert.recordRequests();
        return preq.post({
            uri: `${server.config.baseURL('wikimedia.org')}/media/math/check/tex`,
            headers: { 'content-type': 'application/json' },
            body: { q: f }
        }).then((res) => {
            assert.remoteRequests(false);
            assert.checkString(res.headers['cache-control'], 'no-cache');
        })
        .finally(() => assert.cleanupRecorder());
    });

    it('retrieves the check output of the normalised version', () => {
        assert.recordRequests();
        return preq.post({
            uri: `${server.config.baseURL('wikimedia.org')}/media/math/check/tex`,
            headers: { 'content-type': 'application/json' },
            body: { q: nf }
        }).then((res) => {
            assert.remoteRequests(false);
            assert.checkString(res.headers['cache-control'], 'no-cache');
        })
        .finally(() => assert.cleanupRecorder());
    });

    it('ignores stored version for no-cache', () => {
        assert.recordRequests();
        return preq.post({
            uri: `${server.config.baseURL('wikimedia.org')}/media/math/check/tex`,
            headers: {
                'content-type': 'application/json',
                'cache-control': 'no-cache'
            },
            body: { q: f }
        }).then((res) => {
            assert.remoteRequests(true);
            assert.checkString(res.headers['cache-control'], 'no-cache');
        })
        .finally(() => assert.cleanupRecorder());
    });

    it('gets the formula from storage', () => {
        return preq.get({
            uri: `${server.config.baseURL('wikimedia.org')}/media/math/formula/${hash}`
        }).then((res) => {
            assert.deepEqual(res.status, 200);
            assert.checkString(res.headers['x-resource-location'], hash);
            assert.ok(res.body);
        });
    });

    for (let i = 0; i < formats.length; i++) {
        const format = formats[i];
        const regex = formatRegexp[i];
        it(`gets the render in ${format}`, () => { // eslint-disable-line no-loop-func
            return preq.get({
                uri: `${server.config.baseURL('wikimedia.org')}/media/math/render/${format}/${hash}`
            }).then((res) => {
                assert.checkString(res.headers['content-type'], regex);
                assert.ok(res.body);
            });
        });
    }

});
