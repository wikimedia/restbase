const assert = require('../utils/assert.js');
const preq   = require('preq');
const Server = require('../utils/server.js');

describe('redirect filter', () => {
    const server = new Server();
    before(() => server.start());
    after(() => server.stop());

    it('should redirect the request to the set redirect target', () => {
        return preq.get({ uri: `${server.config.baseURL('ar.wikipedia.beta.wmflabs.org')}/page/html/Main_Page` })
            .then((res) => {
                assert.deepEqual(res.status, 200);
                assert.checkString(res.headers['content-location'], /en.wikipedia.beta.wmflabs.org/);
            });
    });
});
