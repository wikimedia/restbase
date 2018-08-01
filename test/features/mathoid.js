'use strict';

const assert = require('../utils/assert.js');
const server = require('../utils/server.js');
const preq   = require('preq');

describe('Mathoid', function() {

    const f = 'c^2 = a^2 + b^2';
    const nf = 'c^{2}=a^{2}+b^{2}';
    const uri = `${server.config.hostPort}/wikimedia.org/v1/media/math`;
    const formats = ['mml', 'svg', 'png'];
    const formats_regex = [/mathml/, /svg/, /png/];
    let hash;

    this.timeout(20000);

    before(() => { return server.start(); });

    it('checks the formula with Mathoid', () => {
        const slice = server.config.logStream.slice();
        return preq.post({
            uri: `${uri}/check/tex`,
            headers: { 'content-type': 'application/json' },
            body: { q: f }
        }).then((res) => {
            slice.halt();
            hash = res.headers['x-resource-location'];
            assert.localRequests(slice, false);
            assert.remoteRequests(slice, true);
            assert.checkString(res.headers['cache-control'], 'no-cache');
        });
    });

    it('retrieves the check output from storage', () => {
        const slice = server.config.logStream.slice();
        return preq.post({
            uri: `${uri}/check/tex`,
            headers: { 'content-type': 'application/json' },
            body: { q: f }
        }).then((res) => {
            slice.halt();
            assert.localRequests(slice, true);
            assert.remoteRequests(slice, false);
            assert.checkString(res.headers['cache-control'], 'no-cache');
        });
    });

    it('retrieves the check output of the normalised version', () => {
        const slice = server.config.logStream.slice();
        return preq.post({
            uri: `${uri}/check/tex`,
            headers: { 'content-type': 'application/json' },
            body: { q: nf }
        }).then((res) => {
            slice.halt();
            assert.localRequests(slice, true);
            assert.remoteRequests(slice, false);
            assert.checkString(res.headers['cache-control'], 'no-cache');
        });
    });

    it('ignores stored version for no-cache', () => {
        const slice = server.config.logStream.slice();
        return preq.post({
            uri: `${uri}/check/tex`,
            headers: {
                'content-type': 'application/json',
                'cache-control': 'no-cache'
            },
            body: { q: f }
        }).then((res) => {
            slice.halt();
            assert.localRequests(slice, false);
            assert.remoteRequests(slice, true);
            assert.checkString(res.headers['cache-control'], 'no-cache');
        });
    });

    it('gets the formula from storage', () => {
        return preq.get({
            uri: `${uri}/formula/${hash}`
        }).then((res) => {
            assert.deepEqual(res.status, 200);
            assert.checkString(res.headers['x-resource-location'], hash);
            assert.ok(res.body);
        });
    });

    for (let i = 0; i < formats.length; i++) {
        const format = formats[i];
        const regex = formats_regex[i];
        it(`gets the render in ${format}`, () => { // eslint-disable-line no-loop-func
            return preq.get({
                uri: `${uri}/render/${format}/${hash}`
            }).then((res) => {
                assert.checkString(res.headers['content-type'], regex);
                assert.ok(res.body);
            });
        });
    }

});
