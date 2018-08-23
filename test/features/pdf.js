'use strict';

const assert = require('../utils/assert.js');
const server = require('../utils/server.js');
const preq   = require('preq');

describe('PDF Service', () => {

    before(() => server.start());

    // TODO: PDF tests a very unreliable, so skip them until T181084 is resolved
    it.skip('Should get PDF for a page', () => {
        return preq.get({
            uri: `${server.config.hostPort}/ru.wikipedia.org/v1/page/pdf/%D0%94%D0%B0%D1%80%D1%82_%D0%92%D0%B5%D0%B9%D0%B4%D0%B5%D1%80`
        })
        .then((res) => {
            assert.deepEqual(res.status, 200);
            assert.deepEqual(res.headers['content-disposition'],
                'attachment; filename="%D0%94%D0%B0%D1%80%D1%82_%D0%92%D0%B5%D0%B9%D0%B4%D0%B5%D1%80.pdf";'
                    + ' filename*=UTF-8\'\'%D0%94%D0%B0%D1%80%D1%82_%D0%92%D0%B5%D0%B9%D0%B4%D0%B5%D1%80.pdf');
            assert.deepEqual(res.headers['content-type'], 'application/pdf');
            assert.ok(/"\d+\/[\d\w-]+"/.test(res.headers.etag));
            assert.ok(res.body.length !== 0);
        });
    });

    // TODO: PDF tests a very unreliable, so skip them until T181084 is resolved
    it.skip('Should get PDF for a page containing a quote in its title', () => {
        return preq.get({
            uri: `${server.config.hostPort}/en.wikipedia.org/v1/page/pdf/"...And_Ladies_of_the_Club"`
        })
        .then((res) => {
            assert.deepEqual(res.status, 200);
            assert.deepEqual(res.headers['content-disposition'],
                'attachment; filename="%22...And_Ladies_of_the_Club%22.pdf";'
                    + ' filename*=UTF-8\'\'%22...And_Ladies_of_the_Club%22.pdf');
            assert.deepEqual(res.headers['content-type'], 'application/pdf');
            assert.ok(/"\d+\/[\d\w-]+"/.test(res.headers.etag));
            assert.ok(res.body.length !== 0);
        });
    });
});
