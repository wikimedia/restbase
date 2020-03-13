'use strict';

const assert = require('../../utils/assert.js');
const preq   = require('preq');
const Server = require('../../utils/server.js');
const nock   = require('nock');
const P      = require('bluebird');

describe('router - security', function() {
    this.timeout(20000);
    const server = new Server();
    before(() => {
        if (!nock.isActive()) {
            nock.activate();
        }
        return server.start()
        .then(() => {
            // Do preparation requests to force siteInfo fetch so that we don't need to mock it
            return P.join(
                preq.get({uri: `${server.config.bucketURL()}/title/Main_Page`}),
                preq.get({uri: `${server.config.bucketURL('ru.wikipedia.beta.wmflabs.org')}/title/${encodeURIComponent('Заглавная_страница')}`})
            );
        });
    });
    after(() => server.stop());

    const sampleRightsResponse = {
        batchcomplete: '',
        query: {
            userinfo: {
                id: 1,
                name: 'Petr',
                rights: ['createaccount','read','edit']
            }
        }
    };

    const sampleApiResponse = {
        query: {
            pages: {
                '1': {
                    ns: 0,
                    pageid: 1,
                    revisions: [1],
                    title: 'test'
                }
            }
        }
    };

    it('should forward cookies on request to api', () => {
        nock.enableNetConnect();
        const apiURI = server.config.apiURL('ru.wikipedia.beta.wmflabs.org');
        const api = nock(apiURI, {
            reqheaders: {
                cookie: 'test=test_cookie'
            }
        })
        .post('', (body) => { return body && body.generator === 'allpages'; })
        .reply(200, sampleApiResponse)
        .post('', (body) => { return body && body.meta === 'userinfo'; })
        .reply(200, sampleRightsResponse)
        .post('', (body) => { return body && body.meta === 'userinfo'; })
        .optionally()
        .reply(200, sampleRightsResponse);

        return preq.get({
            uri: `${server.config.bucketURL('ru.wikipedia.beta.wmflabs.org')}/title/`,
            headers: {
                'Cookie': 'test=test_cookie'
            }
        })
        .then(() => { api.done(); })
        .finally(() => { nock.cleanAll(); });
    });

    it('should forward cookies on request to parsoid', () => {
        nock.enableNetConnect();
        const title = 'Б';
        const revision = 1831;
        const api = nock(server.config.parsoidURI, {
            reqheaders: {
                cookie: 'test=test_cookie',
                host: 'ru.wikipedia.beta.wmflabs.org',
            }
        })
        .get(`/ru.wikipedia.beta.wmflabs.org/v3/page/pagebundle/${encodeURIComponent(title)}/${revision}`)
        .reply(200, () => {
            return {
                'html': {
                    'headers': {
                        'content-type': 'text/html'
                    },
                    'body': '<html></html>'
                },
                'data-parsoid': {
                    'headers': {
                        'content-type': 'application/json'
                    },
                    'body': {
                        'counter': 1,
                        'ids': {
                            'mwAA': { 'dsr': [0, 1, 0, 0] }
                        },
                        'sectionOffsets': {
                            'mwAQ': { 'html': [0, 1], 'wt': [2, 3] }
                        }
                    }
                }
            };
        });

        return preq.get({
            uri: `${server.config.bucketURL('ru.wikipedia.beta.wmflabs.org')}/html/${encodeURIComponent(title)}/${revision}`,
            headers: {
                'Cookie': 'test=test_cookie',
                'Cache-control': 'no-cache'
            }
        })
        .then(() => { api.done(); })
        .finally(() => { nock.cleanAll(); });
    });

    it('should not forward cookies to external domains', () => {
        const externalURI = 'https://www.mediawiki.org';
        nock.enableNetConnect();
        const api = nock(externalURI, {
            badheaders: ['cookie'],
        })
        .get('/')
        .reply(200);

        return preq.get({
            uri: `${server.config.baseURL('fake.fakepedia.org')}/http/${encodeURIComponent(externalURI)}`,
            headers: {
                'cookie': 'test=test_cookie'
            }
        })
        .then(() => { api.done(); })
        .finally(() => { nock.cleanAll(); });
    });

    it('should not send cookies to non-restricted domains', () => {
        const api = nock(server.config.apiURL(), {
            badheaders: ['cookie']
        })
        .post('', (body) => { return body && body.generator === 'allpages'; })
        .reply(200, sampleApiResponse);

        return preq.get({
            uri: `${server.config.bucketURL()}/title/`,
            headers: {
                'Cookie': 'test=test_cookie'
            }
        })
        .then(() => { api.done(); })
        .finally(() => { nock.cleanAll(); });
    });

    it('should deny access to resources stored in restbase', () => {
        nock.enableNetConnect();
        const title = 'TestingTitle';

        const api = nock(server.config.apiURL('ru.wikipedia.beta.wmflabs.org'))
        .post('')
        .reply(200, {
            'query': {
                'userinfo': {
                    'id': 1,
                    'name': 'test',
                    'rights': ['som right', 'some other right']
                }
            }
        });
        return preq.get({
            uri: `${server.config.bucketURL('ru.wikipedia.beta.wmflabs.org')}/title/${title}`,
            headers: {
                'cache-control': 'no-cache'
            }
        })
        .then(() => {
            throw new Error('Access denied should be posted');
        })
        .catch((e) => {
            assert.deepEqual(e.status, 401);
            assert.contentType(e, 'application/problem+json');
            assert.deepEqual(e.body.detail.indexOf('read') >= 0, true);
        })
        .then(() => { api.done(); })
        .finally(() => { nock.cleanAll();  });
    });
});
