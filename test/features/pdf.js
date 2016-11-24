'use strict';

const assert = require('../utils/assert.js');
const server = require('../utils/server.js');
const preq   = require('preq');

describe('Feed', () => {

    before(() => server.start());

    it('Should get PDF for a page', () => {
        return preq.get({
            uri: `${server.config.hostPort}/ru.wikipedia.org/v1/page/pdf/%D0%94%D0%B0%D1%80%D1%82_%D0%92%D0%B5%D0%B9%D0%B4%D0%B5%D1%80`
        })
        .then((res) => {
            assert.deepEqual(res.status, 200);
            assert.deepEqual(res.headers['content-disposition'],
                'attachment; filename=%D0%94%D0%B0%D1%80%D1%82_%D0%92%D0%B5%D0%B9%D0%B4%D0%B5%D1%80.pdf;'
                    + ' filename*=%D0%94%D0%B0%D1%80%D1%82_%D0%92%D0%B5%D0%B9%D0%B4%D0%B5%D1%80.pdf');
            assert.deepEqual(res.headers['content-type'], 'application/pdf');
            assert.ok(/"\d+\/[\d\w-]+"/.test(res.headers.etag));
            assert.ok(res.body.length !== 0);
        });
    });
});
