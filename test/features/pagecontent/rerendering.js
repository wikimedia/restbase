'use strict';

const assert = require('../../utils/assert.js');
const preq   = require('preq');
const Server = require('../../utils/server.js');
const P = require('bluebird');

function getTid(etag) {
    return /^"[^\/]+\/([^"]+)"/.exec(etag)[1];
}

describe('page re-rendering', function() {
    this.timeout(20000);
    const server = new Server();
    before(() =>  server.start());
    after(() =>  server.stop());

    // A test page that includes the current date, so that it changes if
    // re-rendered more than a second apart.
    const dynamic1 = '/html/User:Pchelolo%2fDate/275850';
    const dynamic2 = '/html/User:Pchelolo%2fDate/275851';

    function hasTextContentType(res) {
        assert.contentType(res, server.config.conf.test.content_types.html);
    }

    it('should render & re-render independent revisions', () => {
        let r1etag1;
        let r1etag2;
        let r2etag1;
        return preq.get({uri: `${server.config.bucketURL('en.wikipedia.beta.wmflabs.org')}${dynamic1}?stash=true`})
        .then((res) => {
            assert.deepEqual(res.status, 200);
            r1etag1 = res.headers.etag;
            hasTextContentType(res);

            // delay for 1s to make sure that the timestamp differs on re-render
            return P.delay(1500)
            .then(() => {
                return preq.get({
                    uri: `${server.config.bucketURL('en.wikipedia.beta.wmflabs.org')}${dynamic1}?stash=true`,
                    headers: { 'cache-control': 'no-cache' }
                });
            });
        })
        .then((res) => {
            // Since this is a dynamic page which should render the same each
            // time, the tid should not change.
            r1etag2 = res.headers.etag;
            assert.notDeepEqual(r1etag2, r1etag1);
            assert.notDeepEqual(r1etag2, undefined);
            hasTextContentType(res);
            return preq.get({uri: `${server.config.bucketURL('en.wikipedia.beta.wmflabs.org')}${dynamic1}}/${getTid(r1etag1)}`});
        })
        .then((res) => {
            assert.deepEqual(res.headers.etag, r1etag1);
            hasTextContentType(res);

            return preq.get({uri: `${server.config.bucketURL('en.wikipedia.beta.wmflabs.org')}${dynamic1}`});
        })
        .then((res) => {
            assert.deepEqual(res.headers.etag, r1etag2);
            hasTextContentType(res);

            return preq.get({uri: `${server.config.bucketURL('en.wikipedia.beta.wmflabs.org')}${dynamic1}}/${getTid(r1etag2)}`});
        })
        .then((res) => {
            assert.deepEqual(res.headers.etag, r1etag2);
            hasTextContentType(res);

            return preq.get({uri: `${server.config.bucketURL('en.wikipedia.beta.wmflabs.org')}${dynamic2}?stash=true`});
        })
        .then((res) => {
            r2etag1 = res.headers.etag;
            assert.deepEqual(res.status, 200);
            hasTextContentType(res);

            return preq.get({uri: `${server.config.bucketURL('en.wikipedia.beta.wmflabs.org')}${dynamic2}/${getTid(r2etag1)}`});
        })
        .then((res) => {
            assert.deepEqual(res.headers.etag, r2etag1);
            hasTextContentType(res);
        });
    });

    it('should render & re-render independent revisions, if-unmodified-since support', () => {
        return preq.get({
            uri: `${server.config.bucketURL('en.wikipedia.beta.wmflabs.org')}${dynamic2}`,
            headers: {
                'cache-control': 'no-cache',
                'if-unmodified-since': 'Wed, 11 Dec 2013 16:00:00 GMT',
            }
        })
        .then(() => {
            throw new Error('Expected a precondition failure');
        },
        (res) => {
            assert.deepEqual(res.status, 412);
        });
    });

    // A static test page
    const static1 = '/html/User:Pchelolo%2fStatic/275852';
    const static2 = '/html/User:Pchelolo%2fStatic/275853';

    it('should render & re-render independent revisions, but not update unchanged content', () => {
        let r1etag1;
        let r1etag2;
        let r2etag1;
        let tid;
        return preq.get({uri: `${server.config.bucketURL('en.wikipedia.beta.wmflabs.org')}${static1}?stash=true`})
        .then((res) => {
            assert.deepEqual(res.status, 200);
            r1etag1 = res.headers.etag;
            hasTextContentType(res);

            return preq.get({
                uri: `${server.config.bucketURL('en.wikipedia.beta.wmflabs.org')}${static1}?stash=true`,
                headers: { 'cache-control': 'no-cache' }
            });
        })
        .then((res) => {
            // Since this is a static page which should render the same each
            // time, the tid should not change.
            r1etag2 = res.headers.etag;
            assert.deepEqual(r1etag2, r1etag1);
            assert.notDeepEqual(r1etag2, undefined);
            hasTextContentType(res);

            return preq.get({uri: `${server.config.bucketURL('en.wikipedia.beta.wmflabs.org')}${static1}/${getTid(r1etag1)}`});
        })
        .then((res) => {
            assert.deepEqual(res.headers.etag, r1etag1);
            hasTextContentType(res);

            return preq.get({uri: `${server.config.bucketURL('en.wikipedia.beta.wmflabs.org')}${static1}`});
        })
        .then((res) => {
            assert.deepEqual(res.headers.etag, r1etag2);
            hasTextContentType(res);

            return preq.get({uri: `${server.config.bucketURL('en.wikipedia.beta.wmflabs.org')}${static1}/${getTid(r1etag2)}`});
        })
        .then((res) => {
            assert.deepEqual(res.headers.etag, r1etag2);
            hasTextContentType(res);

            return preq.get({uri: `${server.config.bucketURL('en.wikipedia.beta.wmflabs.org')}${static2}?stash=true`});
        })
        .then((res) => {
            r2etag1 = res.headers.etag;
            assert.deepEqual(res.status, 200);
            hasTextContentType(res);

            return preq.get({uri: `${server.config.bucketURL('en.wikipedia.beta.wmflabs.org')}${static2}/${getTid(r2etag1)}`});
        })
        .then((res) => {
            assert.deepEqual(res.headers.etag, r2etag1);
            hasTextContentType(res);
        });
    });

});
