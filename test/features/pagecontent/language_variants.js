'use strict';

const assert = require('../../utils/assert.js');
const preq = require('preq');
const Server = require('../../utils/server.js');
const variantsPageTitle = 'RESTBase_Testing_Page';

describe('Page Related', () => {

    const server = new Server();
    before(() => server.start());
    after(() => server.stop());

    it('retrieve correct displaytitle for language variants', () => {
        const uri = `${server.config.bucketURL('zh.wikipedia.beta.wmflabs.org')}/related/%E5%8D%97%E5%8C%97%E6%9C%9D`;
        return preq.get({
            uri,
            headers: {
                'accept-language': 'zh-cn',
            }
        }).then((res) => {
            assert.deepEqual(res.status, 200);
            assert.ok(Array.isArray(res.body.pages));

            // 无政府主义史 is zh-cn for 無政府主義史
            assert.ok(res.body.pages.some(page => page.displaytitle === '<span class=\"mw-page-title-main\">无政府主义史</span>' ));
            assert.deepEqual(res.headers['content-language'], 'zh-cn');
            assert.ok(res.headers['vary'].includes('accept-language'));
        });
    })

});

describe('Language variants', function() {
    this.timeout(20000);
    const server = new Server();

    const parsoid_purged_cache_control = 's-maxage=60, max-age=0, must-revalidate';

    before(async () => {
        // Cleaning require cache because of side-effects
        // on the way modules are instantiated in hyperswitch
        try {
            delete require.cache[require.resolve("../../../v1/summary.js")];
        } catch {
            console.log("Couldn't delete cached module");
        }
        await server.start();
    });

    after(() => server.stop());

    it('should request html with impossible variants', () => {
        return preq.get({ uri: `${server.config.bucketURL()}/html/Main_Page`})
        .then((res) => {
            assert.deepEqual(res.status, 200);
            assert.validateListHeader(res.headers.vary,  { require: ['Accept'], disallow: ['Accept-Language'] });
            assert.deepEqual(res.headers['content-language'], 'en');
            assert.deepEqual(res.headers['cache-control'], parsoid_purged_cache_control);
            assert.checkString(res.headers.etag, /^"\d+\/[a-f0-9-]+"$/);
        });
    });

    let storedEtag;

    it('should request html with no variants', () => {
        return preq.get({ uri: `${server.config.bucketURL('sr.wikipedia.beta.wmflabs.org')}/html/${variantsPageTitle}`})
        .then((res) => {
            storedEtag = res.headers.etag;
            assert.deepEqual(res.status, 200);
            assert.validateListHeader(res.headers.vary,  { require: ['Accept', 'Accept-Language'] });
            assert.deepEqual(res.headers['cache-control'], parsoid_purged_cache_control);
            assert.deepEqual(res.headers['content-language'], 'sr');
            assert.checkString(res.headers.etag, /^"\d+\/[a-f0-9-]+"$/);
            assert.deepEqual(/1\. Ово је тестна страница/.test(res.body), true);
            assert.deepEqual(/2\. Ovo je testna stranica/.test(res.body), true);
        });
    });

    it('should request html with default variant, from storage', () => {
        return preq.get({
            uri: `${server.config.bucketURL('sr.wikipedia.beta.wmflabs.org')}/html/${variantsPageTitle}`,
            headers: {
                'accept-language': 'sr'
            }
        })
        .then((res) => {
            assert.deepEqual(res.status, 200);
            assert.validateListHeader(res.headers.vary,  { require: ['Accept', 'Accept-Language'] });
            assert.deepEqual(res.headers['cache-control'], parsoid_purged_cache_control);
            assert.deepEqual(res.headers['content-language'], 'sr');
            assert.deepEqual(res.headers.etag, storedEtag);
            assert.deepEqual(/1\. Ово је тестна страница/.test(res.body), true);
            assert.deepEqual(/2\. Ovo je testna stranica/.test(res.body), true);
        });
    });

    it('should request html with wrong variant, from storage', () => {
        return preq.get({
            uri: `${server.config.bucketURL('sr.wikipedia.beta.wmflabs.org')}/html/${variantsPageTitle}`,
            headers: {
                'accept-language': 'sr-blablabla'
            }
        })
        .then((res) => {
            assert.deepEqual(res.status, 200);
            assert.validateListHeader(res.headers.vary,  { require: ['Accept', 'Accept-Language'] });
            assert.deepEqual(res.headers['cache-control'], parsoid_purged_cache_control);
            assert.deepEqual(res.headers['content-language'], 'sr');
            assert.deepEqual(res.headers.etag, storedEtag);
            assert.deepEqual(/1\. Ово је тестна страница/.test(res.body), true);
            assert.deepEqual(/2\. Ovo je testna stranica/.test(res.body), true);
        });
    });

    it('should request html with cyrillic variant', () => {
        return preq.get({
            uri: `${server.config.bucketURL('sr.wikipedia.beta.wmflabs.org')}/html/${variantsPageTitle}`,
            headers: {
                'accept-language': 'sr-ec'
            }
        })
        .then((res) => {
            assert.deepEqual(res.status, 200);
            assert.validateListHeader(res.headers.vary,  { require: ['Accept', 'Accept-Language'] });
            assert.deepEqual(res.headers['cache-control'], parsoid_purged_cache_control);
            assert.deepEqual(res.headers['content-language'], 'sr-Cyrl');
            assert.checkString(res.headers.etag, /^"\d+\/[a-f0-9-]+"$/);
            assert.deepEqual(/1\. Ово је тестна страница/.test(res.body), true);
            assert.deepEqual(/2\. Ово је тестна страница/.test(res.body), true);
        });
    });

    it('should request html with latin variant', () => {
        return preq.get({
            uri: `${server.config.bucketURL('sr.wikipedia.beta.wmflabs.org')}/html/${variantsPageTitle}`,
            headers: {
                'accept-language': 'sr-el'
            }
        })
        .then((res) => {
            assert.deepEqual(res.status, 200);
            assert.validateListHeader(res.headers.vary,  { require: ['Accept', 'Accept-Language'] });
            assert.deepEqual(res.headers['cache-control'], parsoid_purged_cache_control);
            assert.deepEqual(res.headers['content-language'], 'sr-Latn');
            assert.checkString(res.headers.etag, /^"\d+\/[a-f0-9-]+"$/);
            assert.deepEqual(/1\. Ovo je testna stranica/.test(res.body), true);
            assert.deepEqual(/2\. Ovo je testna stranica/.test(res.body), true);
        });
    });

    it('should request summary with no variant and not store it (no-storage)', () => {
        // de.wikipedia.beta.wmflabs.org is configured to not use storage while testing
        return preq.get({
            uri: `${server.config.bucketURL('de.wikipedia.beta.wmflabs.org')}/summary/${variantsPageTitle}`
        })
        .then((res) => {
            assert.deepEqual(res.status, 200);
            assert.deepEqual(res.headers['cache-control'], 'test_purged_cache_control_with_client_caching');
            assert.deepEqual(res.headers['content-language'], 'de');
            assert.deepEqual(res.headers['x-restbase-sunset'] || null, 'true');
            assert.checkString(res.headers.etag, /^"\d+\/[a-f0-9-]+"$/);
            assert.deepEqual(res.body.extract, 'Das ist eine testseite.*');
        })
    });

    it('should request summary with no variant and store it', () => {
        let storedEtag;
        return preq.get({
            uri: `${server.config.bucketURL('sr.wikipedia.beta.wmflabs.org')}/summary/${variantsPageTitle}`
        })
        .then((res) => {
            storedEtag = res.headers.etag;
            assert.deepEqual(res.status, 200);
            assert.validateListHeader(res.headers.vary,  { require: ['Accept-Language'], disallow: ['Accept'] });
            assert.deepEqual(res.headers['cache-control'], 'test_purged_cache_control_with_client_caching');
            assert.deepEqual(res.headers['content-language'], 'sr');
            assert.deepEqual(res.headers['x-restbase-sunset'] || null, null);
            assert.checkString(res.headers.etag, /^"\d+\/[a-f0-9-]+"$/);
            assert.deepEqual('1. Ово је тестна страница', res.body.extract);
            // Not try fetching again with a default variant and see if etag matches
            return preq.get({
                uri: `${server.config.bucketURL('sr.wikipedia.beta.wmflabs.org')}/summary/${variantsPageTitle}`,
                headers: {
                    'accept-language': 'sr'
                }
            });
        })
        .then((res) => {
            assert.deepEqual(res.status, 200);
            assert.validateListHeader(res.headers.vary,  { require: ['Accept-Language'], disallow: ['Accept'] });
            assert.deepEqual(res.headers['cache-control'], 'test_purged_cache_control_with_client_caching');
            assert.deepEqual(res.headers['content-language'], 'sr');
            assert.deepEqual(res.headers.etag, storedEtag);
            assert.deepEqual('1. Ово је тестна страница', res.body.extract);
            // Now try the impossible variant and see that stored one is served again.
            return preq.get({
                uri: `${server.config.bucketURL('sr.wikipedia.beta.wmflabs.org')}/summary/${variantsPageTitle}`,
                headers: {
                    'accept-language': 'sr-this-is-no-a-variant'
                }
            });
        })
        .then((res) => {
            assert.deepEqual(res.status, 200);
            assert.validateListHeader(res.headers.vary,  { require: ['Accept-Language'], disallow: ['Accept'] });
            assert.deepEqual(res.headers['cache-control'], 'test_purged_cache_control_with_client_caching');
            assert.deepEqual(res.headers['content-language'], 'sr');
            assert.deepEqual(res.headers.etag, storedEtag);
            assert.deepEqual('1. Ово је тестна страница', res.body.extract);
        });
    });

    it('should request summary with latin variant and not store it', () => {
        return preq.get({
            uri: `${server.config.bucketURL('sr.wikipedia.beta.wmflabs.org')}/summary/${variantsPageTitle}`,
            headers: {
                'accept-language': 'sr-el'
            }
        })
        .then((res) => {
            assert.deepEqual(res.status, 200);
            assert.validateListHeader(res.headers.vary,  { require: ['Accept-Language'], disallow: ['Accept'] });
            assert.deepEqual(res.headers['cache-control'], 'test_purged_cache_control_with_client_caching');
            assert.deepEqual(res.headers['content-language'], 'sr-el');
            assert.checkString(res.headers.etag, /^"\d+\/[a-f0-9-]+"$/);
            assert.deepEqual('1. Ovo je testna stranica', res.body.extract);
            // Try again without variant to see that stored didn't change
            return preq.get({
                uri: `${server.config.bucketURL('sr.wikipedia.beta.wmflabs.org')}/summary/${variantsPageTitle}`,
                headers: {
                    'accept-language': 'sr'
                }
            });
        })
        .then((res) => {
            assert.deepEqual(res.status, 200);
            assert.validateListHeader(res.headers.vary,  { require: ['Accept-Language'], disallow: ['Accept'] });
            assert.deepEqual(res.headers['cache-control'], 'test_purged_cache_control_with_client_caching');
            assert.deepEqual(res.headers['content-language'], 'sr');
            assert.checkString(res.headers.etag, /^"\d+\/[a-f0-9-]+"$/);
            assert.deepEqual('1. Ово је тестна страница', res.body.extract);
        });
    });

    xit('should request mobile-sections with no variant and store it', () => {
        return preq.get({
            uri: `${server.config.bucketURL('sr.wikipedia.beta.wmflabs.org')}/mobile-sections/${variantsPageTitle}`
        })
        .then((res) => {
            assert.deepEqual(res.status, 200);
            assert.validateListHeader(res.headers.vary,  { require: ['Accept-Language'], disallow: ['Accept'] });
            assert.deepEqual(res.headers['cache-control'], 'test_purged_cache_control');
            assert.deepEqual(res.headers['content-language'], 'sr');
            assert.checkString(res.headers.etag, /^(:?W\/)?"\d+\/[a-f0-9-]+"$/);
            assert.deepEqual(/1\. Ово је тестна страница/.test(JSON.stringify(res.body)), true);
            assert.deepEqual(/2\. Ovo je testna stranica/.test(JSON.stringify(res.body)), true);
            // Not try fetching again with a default variant and see if etag matches
            return preq.get({
                uri: `${server.config.bucketURL('sr.wikipedia.beta.wmflabs.org')}/mobile-sections/${variantsPageTitle}`,
                headers: {
                    'accept-language': 'sr'
                }
            });
        })
        .then((res) => {
            assert.deepEqual(res.status, 200);
            assert.validateListHeader(res.headers.vary,  { require: ['Accept-Language'], disallow: ['Accept'] });
            assert.deepEqual(res.headers['cache-control'], 'test_purged_cache_control');
            assert.deepEqual(res.headers['content-language'], 'sr');
            assert.deepEqual(/1\. Ово је тестна страница/.test(JSON.stringify(res.body)), true);
            assert.deepEqual(/2\. Ovo je testna stranica/.test(JSON.stringify(res.body)), true);
            // Now try the impossible variant and see that stored one is served again.
            return preq.get({
                uri: `${server.config.bucketURL('sr.wikipedia.beta.wmflabs.org')}/mobile-sections/${variantsPageTitle}`,
                headers: {
                    'accept-language': 'sr-this-is-no-a-variant'
                }
            });
        })
        .then((res) => {
            assert.deepEqual(res.status, 200);
            assert.validateListHeader(res.headers.vary,  { require: ['Accept-Language'] });
            assert.deepEqual(res.headers['cache-control'], 'test_purged_cache_control');
            assert.deepEqual(res.headers['content-language'], 'sr');
            assert.deepEqual(/1\. Ово је тестна страница/.test(JSON.stringify(res.body)), true);
            assert.deepEqual(/2\. Ovo je testna stranica/.test(JSON.stringify(res.body)), true);
        });
    });

    xit('should request mobile-sections with latin variant and not store it', () => {
        return preq.get({
            uri: `${server.config.bucketURL('sr.wikipedia.beta.wmflabs.org')}/mobile-sections/${variantsPageTitle}`,
            headers: {
                'accept-language': 'sr-el'
            }
        })
        .then((res) => {
            assert.deepEqual(res.status, 200);
            assert.validateListHeader(res.headers.vary,  { require: ['Accept-Language'], disallow: ['Accept'] });
            assert.deepEqual(res.headers['cache-control'], 'test_purged_cache_control');
            assert.deepEqual(res.headers['content-language'], 'sr-el');
            assert.checkString(res.headers.etag, /^(:?W\/)?"\d+\/[a-f0-9-]+"$/);
            assert.deepEqual(/1\. Ovo je testna stranica/.test(JSON.stringify(res.body)), true);
            assert.deepEqual(/2\. Ovo je testna stranica/.test(JSON.stringify(res.body)), true);
            // Try again without variant to see that stored didn't change
            return preq.get({
                uri: `${server.config.bucketURL('sr.wikipedia.beta.wmflabs.org')}/mobile-sections/${variantsPageTitle}`,
                headers: {
                    'accept-language': 'sr'
                }
            });
        })
        .then((res) => {
            assert.deepEqual(res.status, 200);
            assert.validateListHeader(res.headers.vary,  { require: ['Accept-Language'], disallow: ['Accept'] });
            assert.deepEqual(res.headers['cache-control'], 'test_purged_cache_control');
            assert.deepEqual(res.headers['content-language'], 'sr');
            assert.checkString(res.headers.etag, /^(:?W\/)?"\d+\/[a-f0-9-]+"$/);
            assert.deepEqual(/1\. Ово је тестна страница/.test(JSON.stringify(res.body)), true);
            assert.deepEqual(/2\. Ovo je testna stranica/.test(JSON.stringify(res.body)), true);
        });
    });
});
