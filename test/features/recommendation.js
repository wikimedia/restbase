'use strict';

const assert = require('../utils/assert.js');
const Server = require('../utils/server.js');
const preq   = require('preq');

// Tests for Recommendation API description and caption suggestion endpoints.
// TODO: Move to monitored schema checks when non-enwiki domains are supported by the service checker
describe('Recommendation API', () => {

    const server = new Server();
    before(() => server.start());
    after(() => server.stop());

    describe('captions', () => {

        it('addition request succeeds and is well formed', () => {
            const url = `${server.config.baseURL('commons.wikimedia.beta.wmflabs.org')}/data/recommendation/caption/addition/en`;
            return preq.get(url).then((res) => {
                assert.deepEqual(res.status, 200);
                assert.ok(Array.isArray(res.body));
                res.body.forEach((item) => {
                    assert.ok(item.pageid); // pageid is present and is not 0
                    assert.deepEqual(item.ns, 6); // namespace ID is 6 (NS_FILE)
                    assert.ok(item.title); // title is present
                    assert.ok(item.mime);  // MIME type is present
                    assert.ok(item.structured); // structured data is present
                    assert.ok(item.structured.captions); // captions field is present
                    assert.ok(item.globalusage); //global usage field is present
                });
            });
        });

        it('translation request succeeds and is well formed', () => {
            const url = `${server.config.baseURL('commons.wikimedia.beta.wmflabs.org')}/data/recommendation/caption/translation/from/en/to/ru`;
            return preq.get(url).then((res) => {
                assert.deepEqual(res.status, 200);
                assert.ok(Array.isArray(res.body));
                res.body.forEach((item) => {
                    assert.ok(item.pageid); // pageid is present and is not 0
                    assert.deepEqual(item.ns, 6); // namespace ID is 6 (NS_FILE)
                    assert.ok(item.title); // title is present
                    assert.ok(item.mime);  // MIME type is present
                    assert.ok(item.structured); // structured data is present
                    assert.ok(item.structured.captions); // captions field is present
                    assert.ok(item.globalusage); //global usage field is present
                });
            });
        });

    });

    describe('descriptions', () => {

        it('addition request succeeds and is well formed', () => {
            const url = `${server.config.baseURL('wikidata.beta.wmflabs.org')}/data/recommendation/description/addition/en`;
            return preq.get(url).then((res) => {
                assert.deepEqual(res.status, 200);
                assert.ok(Array.isArray(res.body));
                res.body.forEach((item) => {
                    assert.ok(item.pageid); // pageid is present and is not 0
                    assert.deepEqual(item.ns, 0); // namespace ID is 6 (NS_MAIN)
                    assert.ok(item.title); // title is present
                    assert.ok(item.wikibase_item); // wikibase item info is presesnt
                    assert.deepEqual(item.wikibase_item.type, 'item'); // type is 'item'
                    assert.ok(item.wikibase_item.id.startsWith('Q')); // ID is a Q-number
                    assert.ok(item.wikibase_item.labels); // labels field is present
                    assert.ok(item.wikibase_item.descriptions); // descriptions field is present
                    assert.ok(item.wikibase_item.sitelinks); // sitelinks field is present
                });
            });
        });

        it('translation request succeeds and is well formed', () => {
            const url = `${server.config.baseURL('wikidata.beta.wmflabs.org')}/data/recommendation/description/translation/from/en/to/ru`;
            return preq.get(url).then((res) => {
                assert.deepEqual(res.status, 200);
                assert.ok(Array.isArray(res.body));
                res.body.forEach((item) => {
                    assert.ok(item.pageid); // pageid is present and is not 0
                    assert.deepEqual(item.ns, 0); // namespace ID is 6 (NS_MAIN)
                    assert.ok(item.title); // title is present
                    assert.ok(item.wikibase_item); // wikibase item info is present
                    assert.deepEqual(item.wikibase_item.type, 'item'); // type is 'item'
                    assert.ok(item.wikibase_item.id.startsWith('Q')); // ID is a Q-number
                    assert.ok(item.wikibase_item.labels); // labels field is present
                    assert.ok(item.wikibase_item.descriptions); // descriptions field is present
                    assert.ok(item.wikibase_item.sitelinks); // sitelinks field is present
                });
            });
        });

    });

});
