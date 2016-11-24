'use strict';

const assert = require('../utils/assert.js');
const server = require('../utils/server.js');
const preq   = require('preq');

describe('Feed', () => {

    before(() => server.start());

    it('Should get PDF for a page', () => {
        return preq.get({
            uri: `${server.config.bucketURL}/pdf/Test`
        })
        .then((res) => {
            assert.deepEqual(res.status, 200);
            assert.deepEqual(res.headers['content-disposition'], 'attachment; filename=Test.pdf');
            assert.deepEqual(res.headers['content-type'], 'application/pdf');
            assert.ok(/"\d+\/[\d\w-]+"/.test(res.headers.etag));
            assert.ok(res.body.length !== 0);
        });
    });
});
