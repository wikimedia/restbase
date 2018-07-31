'use strict';

const assert = require('../../utils/assert.js');
const preq = require('preq');
const server = require('../../utils/server.js');
const variantsPageTitle = 'RESTBase_Testing_Page';

describe('Language variants', function() {

    this.timeout(20000);

    before(() => server.start());

    it('should request html with impossible variants', () => {
        return preq.get({ uri: `${server.config.labsBucketURL}/html/Main_Page`})
        .then((res) => {
            assert.deepEqual(res.status, 200);
            assert.varyNotContains(res, 'accept');
            assert.varyNotContains(res, 'accept-language');
            assert.deepEqual(res.headers['content-language'], 'en');
            assert.deepEqual(res.headers['cache-control'], 'test_purged_cache_control');
            assert.checkString(res.headers.etag, /^"\d+\/[a-f0-9-]+"$/);
        });
    });

    let storedEtag;

    it('should request html with no variants', () => {
        return preq.get({ uri: `${server.config.variantsWikiBucketURL}/html/${variantsPageTitle}`})
        .then((res) => {
            storedEtag = res.headers.etag;
            assert.deepEqual(res.status, 200);
            assert.varyNotContains(res, 'accept');
            assert.varyContains(res, 'accept-language');
            assert.deepEqual(res.headers['cache-control'], 'test_purged_cache_control');
            assert.deepEqual(res.headers['content-language'], 'sr');
            assert.checkString(res.headers.etag, /^"\d+\/[a-f0-9-]+"$/);
            assert.deepEqual(/1\. Ово је тестна страница/.test(res.body), true);
            assert.deepEqual(/2\. Ovo je testna stranica/.test(res.body), true);
        });
    });

    it('should request html with default variant, from storage', () => {
        return preq.get({
            uri: `${server.config.variantsWikiBucketURL}/html/${variantsPageTitle}`,
            headers: {
                'accept-language': 'sr'
            }
        })
        .then((res) => {
            assert.deepEqual(res.status, 200);
            assert.varyNotContains(res, 'accept');
            assert.varyContains(res, 'accept-language');
            assert.deepEqual(res.headers['cache-control'], 'test_purged_cache_control');
            assert.deepEqual(res.headers['content-language'], 'sr');
            assert.deepEqual(res.headers.etag, storedEtag);
            assert.deepEqual(/1\. Ово је тестна страница/.test(res.body), true);
            assert.deepEqual(/2\. Ovo je testna stranica/.test(res.body), true);
        });
    });

    it('should request html with wrong variant, from storage', () => {
        return preq.get({
            uri: `${server.config.variantsWikiBucketURL}/html/${variantsPageTitle}`,
            headers: {
                'accept-language': 'sr-blablabla'
            }
        })
        .then((res) => {
            assert.deepEqual(res.status, 200);
            assert.varyNotContains(res, 'accept');
            assert.varyContains(res, 'accept-language');
            assert.deepEqual(res.headers['cache-control'], 'test_purged_cache_control');
            assert.deepEqual(res.headers['content-language'], 'sr');
            assert.deepEqual(res.headers.etag, storedEtag);
            assert.deepEqual(/1\. Ово је тестна страница/.test(res.body), true);
            assert.deepEqual(/2\. Ovo je testna stranica/.test(res.body), true);
        });
    });

    it('should request html with cyrillic variant', () => {
        return preq.get({
            uri: `${server.config.variantsWikiBucketURL}/html/${variantsPageTitle}`,
            headers: {
                'accept-language': 'sr-ec'
            }
        })
        .then((res) => {
            assert.deepEqual(res.status, 200);
            assert.varyNotContains(res, 'accept');
            assert.varyContains(res, 'accept-language');
            assert.deepEqual(res.headers['cache-control'], 'test_purged_cache_control');
            assert.deepEqual(res.headers['content-language'], 'sr-ec');
            assert.checkString(res.headers.etag, /^"\d+\/[a-f0-9-]+"$/);
            assert.deepEqual(/1\. Ово је тестна страница/.test(res.body), true);
            assert.deepEqual(/2\. Ово је тестна страница/.test(res.body), true);
        });
    });

    it('should request html with latin variant', () => {
        return preq.get({
            uri: `${server.config.variantsWikiBucketURL}/html/${variantsPageTitle}`,
            headers: {
                'accept-language': 'sr-el'
            }
        })
        .then((res) => {
            assert.deepEqual(res.status, 200);
            assert.varyNotContains(res, 'accept');
            assert.varyContains(res, 'accept-language');
            assert.deepEqual(res.headers['cache-control'], 'test_purged_cache_control');
            assert.deepEqual(res.headers['content-language'], 'sr-el');
            assert.checkString(res.headers.etag, /^"\d+\/[a-f0-9-]+"$/);
            assert.deepEqual(/1\. Ovo je testna stranica/.test(res.body), true);
            assert.deepEqual(/2\. Ovo je testna stranica/.test(res.body), true);
        });
    });

    it('should request summary with no variant and store it', () => {
        let storedEtag;
        return preq.get({
            uri: `${server.config.variantsWikiBucketURL}/summary/${variantsPageTitle}`
        })
        .then((res) => {
            storedEtag = res.headers.etag;
            assert.deepEqual(res.status, 200);
            assert.varyNotContains(res, 'accept');
            assert.varyContains(res, 'accept-language');
            assert.deepEqual(res.headers['cache-control'], 'test_purged_cache_control_with_client_caching');
            assert.deepEqual(res.headers['content-language'], 'sr');
            assert.checkString(res.headers.etag, /^"\d+\/[a-f0-9-]+"$/);
            assert.deepEqual('1. Ово је тестна страница', res.body.extract);
            // Not try fetching again with a default variant and see if etag matches
            return preq.get({
                uri: `${server.config.variantsWikiBucketURL}/summary/${variantsPageTitle}`,
                headers: {
                    'accept-language': 'sr'
                }
            });
        })
        .then((res) => {
            assert.deepEqual(res.status, 200);
            assert.varyContains(res, 'accept-language');
            assert.varyNotContains(res, 'accept');
            assert.deepEqual(res.headers['cache-control'], 'test_purged_cache_control_with_client_caching');
            assert.deepEqual(res.headers['content-language'], 'sr');
            assert.deepEqual(res.headers.etag, storedEtag);
            assert.deepEqual('1. Ово је тестна страница', res.body.extract);
            // Now try the impossible variant and see that stored one is served again.
            return preq.get({
                uri: `${server.config.variantsWikiBucketURL}/summary/${variantsPageTitle}`,
                headers: {
                    'accept-language': 'sr-this-is-no-a-variant'
                }
            });
        })
        .then((res) => {
            assert.deepEqual(res.status, 200);
            assert.varyContains(res, 'accept-language');
            assert.varyNotContains(res, 'accept');
            assert.deepEqual(res.headers['cache-control'], 'test_purged_cache_control_with_client_caching');
            assert.deepEqual(res.headers['content-language'], 'sr');
            assert.deepEqual(res.headers.etag, storedEtag);
            assert.deepEqual('1. Ово је тестна страница', res.body.extract);
        });
    });

    it('should request summary with latin variant and not store it', () => {
        return preq.get({
            uri: `${server.config.variantsWikiBucketURL}/summary/${variantsPageTitle}`,
            headers: {
                'accept-language': 'sr-el'
            }
        })
        .then((res) => {
            assert.deepEqual(res.status, 200);
            assert.varyContains(res, 'accept-language');
            assert.varyNotContains(res, 'accept');
            assert.deepEqual(res.headers['cache-control'], 'test_purged_cache_control_with_client_caching');
            assert.deepEqual(res.headers['content-language'], 'sr-el');
            assert.checkString(res.headers.etag, /^"\d+\/[a-f0-9-]+"$/);
            assert.deepEqual('1. Ovo je testna stranica', res.body.extract);
            // Try again without variant to see that stored didn't change
            return preq.get({
                uri: `${server.config.variantsWikiBucketURL}/summary/${variantsPageTitle}`,
                headers: {
                    'accept-language': 'sr'
                }
            });
        })
        .then((res) => {
            assert.deepEqual(res.status, 200);
            assert.varyContains(res, 'accept-language');
            assert.varyNotContains(res, 'accept');
            assert.deepEqual(res.headers['cache-control'], 'test_purged_cache_control_with_client_caching');
            assert.deepEqual(res.headers['content-language'], 'sr');
            assert.checkString(res.headers.etag, /^"\d+\/[a-f0-9-]+"$/);
            assert.deepEqual('1. Ово је тестна страница', res.body.extract);
        });
    });

    it('should request mobile-sections with no variant and store it', () => {
        return preq.get({
            uri: `${server.config.variantsWikiBucketURL}/mobile-sections/${variantsPageTitle}`
        })
        .then((res) => {
            assert.deepEqual(res.status, 200);
            assert.varyContains(res, 'accept-language');
            assert.varyNotContains(res, 'accept');
            assert.deepEqual(res.headers['cache-control'], 'test_purged_cache_control');
            assert.deepEqual(res.headers['content-language'], 'sr');
            assert.checkString(res.headers.etag, /^(:?W\/)?"\d+\/[a-f0-9-]+"$/);
            assert.deepEqual(/1\. Ово је тестна страница/.test(JSON.stringify(res.body)), true);
            assert.deepEqual(/2\. Ovo je testna stranica/.test(JSON.stringify(res.body)), true);
            // Not try fetching again with a default variant and see if etag matches
            return preq.get({
                uri: `${server.config.variantsWikiBucketURL}/mobile-sections/${variantsPageTitle}`,
                headers: {
                    'accept-language': 'sr'
                }
            });
        })
        .then((res) => {
            assert.deepEqual(res.status, 200);
            assert.varyContains(res, 'accept-language');
            assert.varyNotContains(res, 'accept');
            assert.deepEqual(res.headers['cache-control'], 'test_purged_cache_control');
            assert.deepEqual(res.headers['content-language'], 'sr');
            assert.deepEqual(/1\. Ово је тестна страница/.test(JSON.stringify(res.body)), true);
            assert.deepEqual(/2\. Ovo je testna stranica/.test(JSON.stringify(res.body)), true);
            // Now try the impossible variant and see that stored one is served again.
            return preq.get({
                uri: `${server.config.variantsWikiBucketURL}/mobile-sections/${variantsPageTitle}`,
                headers: {
                    'accept-language': 'sr-this-is-no-a-variant'
                }
            });
        })
        .then((res) => {
            assert.deepEqual(res.status, 200);
            assert.varyContains(res, 'accept-language');
            assert.deepEqual(res.headers['cache-control'], 'test_purged_cache_control');
            assert.deepEqual(res.headers['content-language'], 'sr');
            assert.deepEqual(/1\. Ово је тестна страница/.test(JSON.stringify(res.body)), true);
            assert.deepEqual(/2\. Ovo je testna stranica/.test(JSON.stringify(res.body)), true);
        });
    });

    it('should request mobile-sections with latin variant and not store it', () => {
        return preq.get({
            uri: `${server.config.variantsWikiBucketURL}/mobile-sections/${variantsPageTitle}`,
            headers: {
                'accept-language': 'sr-el'
            }
        })
        .then((res) => {
            assert.deepEqual(res.status, 200);
            assert.varyContains(res, 'accept-language');
            assert.varyNotContains(res, 'accept');
            assert.deepEqual(res.headers['cache-control'], 'test_purged_cache_control');
            assert.deepEqual(res.headers['content-language'], 'sr-el');
            assert.checkString(res.headers.etag, /^(:?W\/)?"\d+\/[a-f0-9-]+"$/);
            assert.deepEqual(/1\. Ovo je testna stranica/.test(JSON.stringify(res.body)), true);
            assert.deepEqual(/2\. Ovo je testna stranica/.test(JSON.stringify(res.body)), true);
            // Try again without variant to see that stored didn't change
            return preq.get({
                uri: `${server.config.variantsWikiBucketURL}/mobile-sections/${variantsPageTitle}`,
                headers: {
                    'accept-language': 'sr'
                }
            });
        })
        .then((res) => {
            assert.deepEqual(res.status, 200);
            assert.varyContains(res, 'accept-language');
            assert.varyNotContains(res, 'accept');
            assert.deepEqual(res.headers['cache-control'], 'test_purged_cache_control');
            assert.deepEqual(res.headers['content-language'], 'sr');
            assert.checkString(res.headers.etag, /^(:?W\/)?"\d+\/[a-f0-9-]+"$/);
            assert.deepEqual(/1\. Ово је тестна страница/.test(JSON.stringify(res.body)), true);
            assert.deepEqual(/2\. Ovo je testna stranica/.test(JSON.stringify(res.body)), true);
        });
    });
});