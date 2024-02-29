'use strict';

const assert = require('../../utils/assert.js');
const preq = require('preq');
const Server = require('../../utils/server.js');
const P = require('bluebird');

describe('item requests', function() {
    this.timeout(20000);
    let pagingToken = '';
    let contentTypes;
    let hostPort;
    const title = 'Earth';
    const revision = '358126';
    const prevRevisions = ['358125', '214592', '214591']
    const domainWithStorageDisabled = "es.wikipedia.beta.wmflabs.org";

    const server = new Server();
    before(() => server.start()
    .then(() => {
        hostPort = server.config.hostPort;
        contentTypes = server.config.conf.test.content_types;
    }));
    after(() => server.stop());

    const deniedTitle = 'User:Pchelolo/Restricted Revision';
    const deniedRev = '409440';

    function deniedContentUri(format) {
        return [server.config.bucketURL(), format, encodeURIComponent(deniedTitle), deniedRev].join('/');
    }

    const sysURL = (domain) => {
        domain = domain || server.config.defaultDomain;
        return `${hostPort}/${domain}/sys_passthrough`;
    };

    const sysGet = (domain, path, opt = {}) => {
        const uri = `${sysURL(domain)}/${path}`;
        return preq.get( { uri, ...opt } );
    };

    const assertCORS = (res) => {
        assert.deepEqual(res.headers['access-control-allow-origin'], '*');
        assert.deepEqual(res.headers['access-control-allow-methods'], 'GET,HEAD');
        assert.deepEqual(res.headers['access-control-allow-headers'],
            'accept, content-type, content-length, cache-control, '
            + 'accept-language, api-user-agent, if-match, if-modified-since, '
            + 'if-none-match, dnt, accept-encoding');
        assert.deepEqual(res.headers['access-control-expose-headers'], 'etag');
        assert.deepEqual(res.headers['referrer-policy'], 'origin-when-cross-origin');
    };
    const createTest = (method) => {
        it(`should respond to ${method} request with CORS headers`, () => {
            return preq[method]({ uri: `${server.config.bucketURL()}/html/${title}/${revision}` })
            .then((res) => {
                assert.deepEqual(res.status, 200);
                assertCORS(res);
            });
        });
    };
    createTest('options');
    createTest('get');
    it(`should respond to GET request with CORS headers, 404`, () => {
        return preq.get({ uri: `${server.config.bucketURL()}/html/This_page_is_likely_does_not_exist` })
        .catch((res) => {
            assert.deepEqual(res.status, 404);
            assertCORS(res);
        });
    });

    it('should fetch for Main_Page', function () {
        return preq.get({
            uri: `${server.config.bucketURL()}/html/Main_Page`,
        })
        .then((res) => {
            assert.deepEqual(res.status, 200);
            assert.validateListHeader(res.headers.vary,  { require: ['Accept'], disallow: [''] });

            return preq.get({
                uri: `${server.config.bucketURL()}/html/Main_Page`
            });
        })
    });
    it(`should fetch HTML revision with id ${prevRevisions[0]}`, () => {
        return preq.get({
            uri: `${server.config.bucketURL()}/html/${title}/${prevRevisions[0]}`,
        })
        .then((res) => {
            assert.deepEqual(res.status, 200);
            assert.validateListHeader(res.headers.vary,  { require: ['Accept'], disallow: [''] });
        });
    });

    it('should fetch page lints. no revision', () => {
        return preq.get({
            uri: `${server.config.bucketURL()}/lint/User%3APchelolo%2FLintTest`
        })
        .then((res) => {
            assert.deepEqual(res.status, 200);
            assert.deepEqual(res.body.length > 0, true);
        });
    });

    it('should fetch page lints. with revision', () => {
        return preq.get({
            uri: `${server.config.bucketURL()}/lint/User%3APchelolo%2FLintTest/409437`
        })
        .then((res) => {
            assert.deepEqual(res.status, 200);
            assert.deepEqual(res.body.length > 0, true);
        });
    });

    it(`should return data-parsoid with id ${prevRevisions[1]}, rev 2`, () => {
        return preq.get({
            uri: `${server.config.bucketURL()}/html/${title}/${prevRevisions[1]}`
        })
        .then((res) => {
            assert.deepEqual(res.status, 200);
            assert.validateListHeader(res.headers.vary,  { require: ['Accept'], disallow: [''] });
        });
    });

    it('should list APIs using the generic listing handler', () => {
        return preq.get({
            uri: `${server.config.hostPort}/${server.config.defaultDomain}/`
        })
        .then((res) => {
            assert.deepEqual(res.status, 200);
            assert.contentType(res, 'application/json');
            assert.deepEqual(res.body, {
                items: ['sys_passthrough', 'v1']
            });
        });
    });

    it('should retrieve the spec', () => {
        return preq.get({
            uri: `${server.config.baseURL()}/?spec`
        })
        .then((res) => {
            assert.deepEqual(res.status, 200);
            assert.contentType(res, 'application/json');
            assert.deepEqual(res.body.openapi, '3.0.1');
        });
    });

    it('should retrieve the swagger-ui main page', () => {
        return preq.get({
            uri: `${server.config.baseURL()}/`,
            headers: { accept: 'text/html' }
        })
        .then((res) => {
            assert.deepEqual(res.status, 200);
            assert.contentType(res, 'text/html');
            assert.deepEqual(/<html/.exec(res.body)[0], '<html');
        });
    });

    it('should retrieve all dependencies of the swagger-ui main page', () => {
        return preq.get({ uri: `${server.config.baseURL()}/?doc` })
        .then((res) => {
            const assertions = [];
            const linkRegex = /<link\s[^>]*href=["']([^"']+)["']/g;
            const scriptRegex =  /<script\s[^>]*src=["']([^"']+)["']/g;
            let match;
            while (match = linkRegex.exec(res.body)) {
                assertions.push(match[1]);
            }
            while (match = scriptRegex.exec(res.body)) {
                assertions.push(match[1]);
            }
            return P.all(assertions.map((path) => {
                return preq.get({ uri: `${server.config.baseURL}/${path}` })
                .then((res) => {
                    assert.deepEqual(res.status, 200);
                });
            }));
        });
    });

    it('should retrieve domain listing in html', () => {
        return preq.get({
            uri: `${server.config.hostPort}/`,
            headers: {
                accept: 'text/html'
            }
        })
        .then((res) => {
            assert.deepEqual(res.status, 200);
            assert.contentType(res, 'text/html');
            assert.deepEqual(/<html/.exec(res.body)[0], '<html');
        });
    });

    it('should list page titles', () => {
        return preq.get({
            uri: `${server.config.bucketURL()}/title/`
        })
        .then((res) => {
            assert.deepEqual(res.status, 200);
            assert.contentType(res, 'application/json');
            if (!res.body.items || !res.body.items.length) {
                throw new Error("Empty listing result!");
            }
            pagingToken = res.body._links.next.href;
        });
    });


    it('should list another set of page titles using pagination', () => {
        return preq.get({
            uri: `${server.config.bucketURL()}/title/${pagingToken}`,
        })
        .then((res) => {
            assert.deepEqual(res.status, 200);
            assert.contentType(res, 'application/json');
            if (!res.body.items || !res.body.items.length) {
                throw new Error("Empty listing result!");
            }
        });
    });

    it('should deny access to the HTML of a restricted revision', () => {
        return preq.get({ uri: deniedContentUri('html') }).then((res) => {
            assert.fail(`Expected status 403, but gotten ${res.status}`);
        }, (res) => {
            assert.deepEqual(res.status, 403);
        });
    });

    it('should deny access to restricted revision even after re-fetching it', () => {
        return preq.get({
            uri: deniedContentUri('html'),
            headers: { 'cache-control': 'no-cache' }
        }).then((res) => {
            assert.fail(`Expected status 403, but gotten ${res.status}`);
        }, (res) => {
            assert.deepEqual(res.status, 403);
        });
    });

    it('Should throw error for invalid title access', () => {
        return preq.get({
            uri: `${server.config.bucketURL()}/html/[asdf]`
        })
        .then(() => {
            throw new Error('Error should be thrown');
        }, (e) => {
            assert.deepEqual(e.status, 400);
            assert.deepEqual(e.body.detail, 'title-invalid-characters');
        });
    });

    it('should list available properties', () => {
        return preq.get({
            uri: `${server.config.bucketURL()}/`,
        })
        .then((res) => {
            assert.deepEqual(res.status, 200);
            if (!res.body.items || res.body.items.indexOf('html') === -1) {
                throw new Error('Expected property listing that includes "html"');
            }
        });
    });
});
