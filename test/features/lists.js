'use strict';

const nock = require('nock');
const assert = require('../utils/assert.js');
const Server = require('../utils/server.js');
const querystring = require('querystring');
const preq = require('preq');

describe('reading lists', function() {
    this.timeout(20000);
    const server = new Server();
    const csrfToken = '<mock>';
    const sessionCookies = '<mock>';

    function getApi() {
        return nock(server.config.apiBase(), {
            reqheaders: {
                'Cookie': sessionCookies,
                'Host': server.config.defaultDomain,
            },
        })
        .defaultReplyHeaders({
            'Content-Type': 'application/json; charset=utf-8',
        });
    }

    // workaround for https://github.com/node-nock/nock/issues/852
    // also for object ordering issues
    function nockDiff(expected) {
        return (actual) => {
            if (typeof actual === 'string' && typeof expected === 'object') {
                actual = querystring.parse(actual);
            }
            try {
                assert.deepEqual(actual, expected, 'nock failure');
                return true;
            } catch (e) {
                // eslint-disable-next-line no-console
                console.log(e);
                return false;
            }
        };
    }

    function unmockedListener(req) {
        if (!req.href.startsWith(`${server.config.baseURL()}/data/lists/`)) {
            throw Error(`Unmocked request to ${req.href}`);
        }
    }

    before(() => {
        if (!nock.isActive()) {
            nock.activate();
        }
        return server.start()
        // Do a preparation request to force siteinfo fetch so that we don't need to mock it
        .then(() => preq.get({
            uri: `${server.config.baseURL()}/page/html/Main_Page`,
        }))
        // After this, there should be no unmocked requests other than those to /lists
        .then(() => nock.emitter.on('no match', unmockedListener));
    });

    after(() => {
        nock.emitter.removeListener('no match', unmockedListener);
        return server.stop();
    });

    afterEach(() => {
        nock.cleanAll();
    });

    describe('POST /lists/setup', () => {
        it('forward call', () => {
            const scope = getApi()
                .post(server.config.apiPath, nockDiff({
                    action: 'readinglists',
                    command: 'setup',
                    token: csrfToken,
                    format: 'json',
                    formatversion: '2',
                }))
                .reply(200, {});

            return preq.post({
                uri: `${server.config.baseURL()}/data/lists/setup`,
                query: {
                    csrf_token: csrfToken,
                },
                headers: {
                    'Cookie': sessionCookies,
                },
            })
            .finally(() => scope.done())
            .then((res) => {
                assert.deepEqual(res.status, 200);
            });
        });

        it('error handling', () => {
            const scope = getApi()
                .post(server.config.apiPath, nockDiff({
                    action: 'readinglists',
                    command: 'setup',
                    token: csrfToken,
                    format: 'json',
                    formatversion: '2',
                }))
                .reply(200, {
                    error: {
                        code: 'badtoken',
                        info: 'Invalid CSRF token.',
                    },
                }, {
                    'MediaWiki-API-Error': 'badtoken',
                });

            return preq.post({
                uri: `${server.config.baseURL()}/data/lists/setup`,
                query: {
                    csrf_token: csrfToken,
                },
                headers: {
                    'Cookie': sessionCookies,
                },
            })
            .finally(() => scope.done())
            .tap(() => {
                throw new Error('should not have succeeded');
            })
            .catch({ name: 'HTTPError' }, (res) => {
                assert.deepEqual(res.status, 400);
                assert.deepEqual(res.body.title, 'badtoken');
                assert.deepEqual(res.body.detail, 'Invalid CSRF token.');
            });
        });
    });

    describe('POST /lists/teardown', () => {
        it('forward call', () => {
            const scope = getApi()
                .post(server.config.apiPath, nockDiff({
                    action: 'readinglists',
                    command: 'teardown',
                    token: csrfToken,
                    format: 'json',
                    formatversion: '2',
                }))
                .reply(200, {});

            return preq.post({
                uri: `${server.config.baseURL()}/data/lists/teardown`,
                query: {
                    csrf_token: csrfToken,
                },
                headers: {
                    'Cookie': sessionCookies,
                },
            })
            .finally(() => scope.done())
            .then((res) => {
                assert.deepEqual(res.status, 200);
            });
        });
    });

    describe('GET /lists/', () => {
        const listEntry = {
            id: 1,
            name: 'default',
            default: true,
            description: '',
            color: '',
            image: '',
            icon: '',
            created: '2017-09-27T06:59:13Z',
            updated: '2017-10-17T07:40:50Z',
            order: [ 1, 2, 3 ],
            listOrder: [ 1, 2 ],
        };

        it('forward call', () => {
            const scope = getApi()
                .post(server.config.apiPath, nockDiff({
                    action: 'query',
                    meta: 'readinglists',
                    rllimit: 'max',
                    rlsort: 'updated',
                    rldir: 'descending',
                    format: 'json',
                    formatversion: '2',
                }))
                .reply(200, {
                    query: {
                        readinglists: [ listEntry ],
                    },
                });

            return preq.get({
                uri: `${server.config.baseURL()}/data/lists/`,
                headers: {
                    'Cookie': sessionCookies,
                },
            })
            .finally(() => scope.done())
            .then((res) => {
                // override continue-from timestamp
                res.body['continue-from'] = '<mock>';
                assert.deepEqual(res.status, 200);
                assert.deepEqual(res.body, {
                    lists: [ listEntry ],
                    'continue-from': '<mock>',
                });
            });
        });

        it('paging', () => {
            const scope = getApi()
                .post(server.config.apiPath, nockDiff({
                    action: 'query',
                    meta: 'readinglists',
                    rllimit: 'max',
                    rlsort: 'updated',
                    rldir: 'descending',
                    format: 'json',
                    formatversion: '2',
                }))
                .reply(200, {
                    query: {
                        readinglists: [ listEntry ],
                    },
                    continue: {
                        rlcontinue: 1,
                        continue: '-||',
                    },
                });

            return preq.get({
                uri: `${server.config.baseURL()}/data/lists/`,
                headers: {
                    'Cookie': sessionCookies,
                },
            })
            .finally(() => scope.done())
            .then((res) => {
                // override continue-from timestamp
                res.body['continue-from'] = '<mock>';
                assert.deepEqual(res.status, 200);
                assert.deepEqual(res.body, {
                    lists: [ listEntry ],
                    next: '{"rlcontinue":1,"continue":"-||"}',
                    'continue-from': '<mock>',
                });
            });
        });

        it('paging 2', () => {
            const scope = getApi()
                .post(server.config.apiPath, nockDiff({
                    action: 'query',
                    meta: 'readinglists',
                    rlsort: 'updated',
                    rldir: 'descending',
                    rllimit: 'max',
                    rlcontinue: 1,
                    continue: '-||',
                    format: 'json',
                    formatversion: '2',
                }))
                .reply(200, {
                    query: {
                        readinglists: [ listEntry ],
                    },
                });

            return preq.get({
                uri: `${server.config.baseURL()}/data/lists/`,
                query: {
                    next: '{"rlcontinue":1,"continue":"-||"}',
                },
                headers: {
                    'Cookie': sessionCookies,
                },
            })
            .finally(() => scope.done())
            .then((res) => {
                // override continue-from timestamp
                res.body['continue-from'] = '<mock>';
                assert.deepEqual(res.status, 200);
                assert.deepEqual(res.body, {
                    lists: [ listEntry ],
                    'continue-from': '<mock>',
                });
            });
        });

        it('paging error', () => {
            const scope = getApi();

            return preq.get({
                uri: `${server.config.baseURL()}/data/lists/`,
                query: {
                    next: '{invalid}',
                },
                headers: {
                    'Cookie': sessionCookies,
                },
            })
            .finally(() => scope.done())
            .tap(() => {
                throw new Error('should not have succeeded');
            })
            .catch({ name: 'HTTPError' }, (res) => {
                assert.deepEqual(res.status, 400);
                assert.deepEqual(res.body.type,
                    'https://mediawiki.org/wiki/HyperSwitch/errors/server_error#invalid_paging_parameter');
            });
        });
    });

    describe('POST /lists/', () => {
        it('forward call', () => {
            const scope = getApi()
                .post(server.config.apiPath, nockDiff({
                    action: 'readinglists',
                    command: 'create',
                    name: 'Test list',
                    description: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit.',
                    token: csrfToken,
                    format: 'json',
                    formatversion: '2',
                }))
                .reply(200, {
                    create: {
                        id: 2,
                    },
                });

            return preq.post({
                uri: `${server.config.baseURL()}/data/lists/`,
                query: {
                    csrf_token: csrfToken,
                },
                body: {
                    name: 'Test list',
                    description: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit.',
                    color: 'red',
                    image: 'Foo.png',
                    icon: 'foo',
                },
                headers: {
                    'Cookie': sessionCookies,
                    'content-type': 'application/json',
                },
            })
            .finally(() => scope.done())
            .then((res) => {
                assert.deepEqual(res.status, 200);
                assert.deepEqual(res.body.id, 2);
            });
        });
    });

    describe('PUT /lists/{id}', () => {
        it('forward call', () => {
            const scope = getApi()
                .post(server.config.apiPath, nockDiff({
                    action: 'readinglists',
                    command: 'update',
                    list: 2,
                    name: 'Test list!',
                    description: 'Lorem ipsum dolor sit amet',
                    token: csrfToken,
                    format: 'json',
                    formatversion: '2',
                }))
                .reply(200, {
                    update:{
                        id: 1,
                        list: {
                            id: 2,
                            name: 'Test list!',
                            description: 'Lorem ipsum dolor sit amet',
                        }
                    }
                });

            return preq.put({
                uri: `${server.config.baseURL()}/data/lists/2`,
                query: {
                    csrf_token: csrfToken,
                },
                body: {
                    name: 'Test list!',
                    description: 'Lorem ipsum dolor sit amet',
                    color: 'blue',
                    image: 'Bar.png',
                    icon: 'bar',
                },
                headers: {
                    'Cookie': sessionCookies,
                    'content-type': 'application/json',
                },
            })
            .finally(() => scope.done())
            .then((res) => {
                assert.deepEqual(res.status, 200);
            });
        });
    });

    describe('DELETE /lists/{id}', () => {
        it('forward call', () => {
            const scope = getApi()
                .post(server.config.apiPath, nockDiff({
                    action: 'readinglists',
                    command: 'delete',
                    list: 2,
                    token: csrfToken,
                    format: 'json',
                    formatversion: '2',
                }))
                .reply(200, {});

            return preq.delete({
                uri: `${server.config.baseURL()}/data/lists/2`,
                query: {
                    csrf_token: csrfToken,
                },
                headers: {
                    'Cookie': sessionCookies,
                },
            })
            .finally(() => scope.done())
            .then((res) => {
                assert.deepEqual(res.status, 200);
            });
        });
    });

    describe('POST /lists/batch', () => {
        it('forward call', () => {
            const batchLists = [
                {
                    name: 'Test batch list item 1',
                    description: 'Lorem ipsum dolor sit amet unus.'
                },
                {
                    name: 'Test batch list item 2',
                    description: 'Lorem ipsum dolor sit amet duo.'
                },
            ];
            const scope = getApi()
                .post(server.config.apiPath, nockDiff({
                    action: 'readinglists',
                    command: 'create',
                    batch: JSON.stringify(batchLists),
                    token: csrfToken,
                    format: 'json',
                    formatversion: '2',
                }))
                .reply(200, {
                    create: {
                        ids: [7,8],
                        lists: [
                            {
                                id: 1,
                                name: 'Test batch list item 1',
                                description: 'Lorem ipsum dolor sit amet unus.',
                                created: '2018-08-30T13:44:04.242Z',
                                updated: '2018-08-30T13:44:04.242Z',
                            },
                            {
                                id: 2,
                                name: 'Test batch list item 2',
                                description: 'Lorem ipsum dolor sit amet duo.',
                                created: '2018-08-30T13:44:04.242Z',
                                updated: '2018-08-30T13:44:04.242Z',
                            },
                        ],
                    },
                });

            return preq.post({
                uri: `${server.config.baseURL()}/data/lists/batch`,
                query: {
                    csrf_token: csrfToken,
                },
                body: {
                    batch: batchLists,
                },
                headers: {
                    'Cookie': sessionCookies,
                    'content-type': 'application/json',
                },
            })
            .finally(() => scope.done())
            .then((res) => {
                assert.deepEqual(res.status, 200);
                assert.deepEqual(res.body, {
                    batch: [
                        {
                            'id': 7
                        },
                        {
                            'id': 8
                        }
                    ],
                    lists: [
                        {
                            id: 1,
                            name: 'Test batch list item 1',
                            description: 'Lorem ipsum dolor sit amet unus.',
                            created: '2018-08-30T13:44:04.242Z',
                            updated: '2018-08-30T13:44:04.242Z'
                        },
                        {
                            id: 2,
                            name: 'Test batch list item 2',
                            description: 'Lorem ipsum dolor sit amet duo.',
                            created: '2018-08-30T13:44:04.242Z',
                            updated: '2018-08-30T13:44:04.242Z'
                        },
                    ],
                });
            });
        });
    });

    describe('GET /lists/{id}/entries/', () => {
        let entries;
        let expectedEntries;
        before(() => {
            entries = [
                {
                    id: 10,
                    listId: 4,
                    project: server.config.defaultDomain,
                    title: 'Foo Bar',
                    created: '2017-09-27T06:59:13Z',
                    updated: '2017-10-17T07:40:50Z',
                },
                {
                    id: 11,
                    listId: 4,
                    project: server.config.defaultDomain,
                    title: 'Boo(m)?',
                    created: '2017-09-27T06:59:13Z',
                    updated: '2017-10-17T07:40:50Z',
                },
            ];
            expectedEntries = [
                {
                    id: 10,
                    listId: 4,
                    project: server.config.defaultDomain,
                    title: 'Foo Bar',
                    summary: {
                        title: 'Foo_Bar',
                        normalizedtitle: 'Foo Bar',
                        summaryData: '<data1>',
                    },
                    created: '2017-09-27T06:59:13Z',
                    updated: '2017-10-17T07:40:50Z',
                },
                {
                    id: 11,
                    listId: 4,
                    project: server.config.defaultDomain,
                    title: 'Boo(m)?',
                    summary: {
                        title: 'Boo(m)?',
                        normalizedtitle: 'Boo(m)?',
                        summaryData: '<data2>',
                    },
                    created: '2017-09-27T06:59:13Z',
                    updated: '2017-10-17T07:40:50Z',
                },
            ];
        });

        function getEnwikiMock() {
            return nock(`https://${server.config.defaultDomain}`, {
                // FIXME should not send cookies to a different domain
                // badheaders: [ 'Cookie' ],
            })
            .defaultReplyHeaders({
                'Content-Type': 'application/json; charset=utf-8',
            })
            .post(server.config.apiPath, (query) => {
                const params = (typeof query === 'string') ? querystring.parse(query) : query;
                return params.action === 'query' && params.meta === 'siteinfo|filerepoinfo'
                    && !params.list && !params.prop;
            })
            .optionally()
            // The siteinfo response is huge and /lists only uses it to verify the domain.
            // Only mock enough of it to make ActionService.siteinfo not fail.
            .reply(200, {
                query: {
                    general: {
                        lang: 'en',
                        legaltitlechars: ' %!"$&\'()*,\\-.\\/0-9:;=?@A-Z\\\\^_`a-z~\\x80-\\xFF+',
                        case: 'first-letter',
                    },
                    namespaces: {
                        '0': {
                            id: 0,
                            case: 'first-letter',
                            content: '',
                            '*': ''
                        },
                    },
                    namespacealiases: [],
                    specialpagealiases: [],
                    repos: [
                        {
                            name: 'shared',
                            descBaseUrl: 'https://commons.wikimedia.org/wiki/File:',
                        },
                    ],
                },
            });
        }

        it('forward call', () => {
            const scope = getApi()
                .post(server.config.apiPath, nockDiff({
                    action: 'query',
                    list: 'readinglistentries',
                    rlelists: 4,
                    rlesort: 'updated',
                    rledir: 'descending',
                    rlelimit: 'max',
                    format: 'json',
                    formatversion: '2',
                }))
                .reply(200, {
                    query: {
                        readinglistentries: entries,
                    },
                });
            const scope2 = getEnwikiMock()
                .get('/api/rest_v1/page/summary/Foo_Bar')
                .reply(200, { title: 'Foo Bar', summaryData: '<data1>' })
                .get('/api/rest_v1/page/summary/Boo(m)%3F')
                .reply(200, { title: 'Boo(m)?', summaryData: '<data2>' });

            return preq.get({
                uri: `${server.config.baseURL()}/data/lists/4/entries/`,
                headers: {
                    'Cookie': sessionCookies,
                },
            })
            .finally(() => {
                scope.done();
                scope2.done();
            })
            .then((res) => {
                assert.deepEqual(res.status, 200);
                assert.deepEqual(res.body, {
                    entries: expectedEntries,
                });
            });
        });

        it('paging', () => {
            const scope = getApi()
                .post(server.config.apiPath, nockDiff({
                    action: 'query',
                    list: 'readinglistentries',
                    rlelists: 4,
                    rlesort: 'updated',
                    rledir: 'descending',
                    rlelimit: 'max',
                    format: 'json',
                    formatversion: '2',
                }))
                .reply(200, {
                    query: {
                        readinglistentries: entries.slice(0, 1),
                    },
                    continue: {
                        rlecontinue: 1,
                        continue: '-||',
                    },
                });
            const scope2 = getEnwikiMock()
                .get('/api/rest_v1/page/summary/Foo_Bar')
                .reply(200, { title: 'Foo Bar', summaryData: '<data1>' });

            return preq.get({
                uri: `${server.config.baseURL()}/data/lists/4/entries/`,
                headers: {
                    'Cookie': sessionCookies,
                },
            })
            .finally(() => {
                scope.done();
                scope2.done();
            })
            .then((res) => {
                assert.deepEqual(res.status, 200);
                assert.deepEqual(res.body, {
                    entries: expectedEntries.slice(0, 1),
                    next: '{"rlecontinue":1,"continue":"-||"}',
                });
            });
        });

        it('paging2', () => {
            const scope = getApi()
                .post(server.config.apiPath, nockDiff({
                    action: 'query',
                    list: 'readinglistentries',
                    rlelists: 4,
                    rlesort: 'updated',
                    rledir: 'descending',
                    rlelimit: 'max',
                    rlecontinue: 1,
                    continue: '-||',
                    format: 'json',
                    formatversion: '2',
                }))
                .reply(200, {
                    query: {
                        readinglistentries: entries.slice(1),
                    },
                });
            const scope2 = getEnwikiMock()
                .get('/api/rest_v1/page/summary/Boo(m)%3F')
                .reply(200, { title: 'Boo(m)?', summaryData: '<data2>' });

            return preq.get({
                uri: `${server.config.baseURL()}/data/lists/4/entries/`,
                query: {
                    next: '{"rlecontinue":1,"continue":"-||"}',
                },
                headers: {
                    'Cookie': sessionCookies,
                },
            })
            .finally(() => {
                scope.done();
                scope2.done();
            })
            .then((res) => {
                assert.deepEqual(res.status, 200);
                assert.deepEqual(res.body, {
                    entries: expectedEntries.slice(1),
                });
            });
        });

        it('no cookie forwarding to unknown domains', () => {
            const entries = [
                {
                    id: 1,
                    listId: 1,
                    project: 'de.fakepedia.org',
                    title: 'Barack Obama',
                    created: '2017-09-27T06:59:13Z',
                    updated: '2017-10-17T07:40:50Z',
                },
            ];

            const scope = getApi()
                .post(server.config.apiPath, nockDiff({
                    action: 'query',
                    list: 'readinglistentries',
                    rlelists: 1,
                    rlesort: 'updated',
                    rledir: 'descending',
                    rlelimit: 'max',
                    format: 'json',
                    formatversion: '2',
                }))
                .reply(200, {
                    query: {
                        readinglistentries: entries,
                    },
                });

            return preq.get({
                uri: `${server.config.baseURL()}/data/lists/1/entries/`,
                headers: {
                    'Cookie': sessionCookies,
                },
            })
            .finally(() => {
                scope.done();
            })
            .then((res) => {
                assert.deepEqual(res.status, 200);
            });
        });
    });

    describe('POST /lists/{id}/entries/', () => {
        it('forward call', () => {
            const scope = getApi()
                .post(server.config.apiPath, nockDiff({
                    action: 'readinglists',
                    command: 'createentry',
                    list: '3',
                    project: server.config.defaultDomain,
                    title: 'Barack Obama',
                    token: csrfToken,
                    format: 'json',
                    formatversion: '2',
                }))
                .reply(200, {
                    createentry: {
                        id: 1,
                    },
                });

            return preq.post({
                uri: `${server.config.baseURL()}/data/lists/3/entries/`,
                query: {
                    csrf_token: csrfToken,
                },
                body: {
                    project: server.config.defaultDomain,
                    title: 'Barack Obama',
                },
                headers: {
                    'Cookie': sessionCookies,
                    'content-type': 'application/json',
                },
            })
            .finally(() => scope.done())
            .then((res) => {
                assert.deepEqual(res.status, 200);
                assert.deepEqual(res.body.id, 1);
            });
        });

    });

    describe('DELETE /lists/{id}/entries/{entry_id}', () => {
        it('forward call', () => {
            const scope = getApi()
                .post(server.config.apiPath, nockDiff({
                    action: 'readinglists',
                    command: 'deleteentry',
                    entry: 1,
                    token: csrfToken,
                    format: 'json',
                    formatversion: '2',
                }))
                .reply(200, {});

            return preq.delete({
                uri: `${server.config.baseURL()}/data/lists/3/entries/1`,
                query: {
                    csrf_token: csrfToken,
                },
                headers: {
                    'Cookie': sessionCookies,
                },
            })
            .finally(() => scope.done())
            .then((res) => {
                assert.deepEqual(res.status, 200);
            });
        });
    });

    describe('POST /lists/{id}/entries/batch', () => {
        it('forward call', () => {
            const batchEntries = [
                {
                    project: server.config.defaultDomain,
                    title: 'Foobar',
                },
                {
                    project: server.config.defaultDomain,
                    title: 'Dog',
                },
            ];
            const scope = getApi()
                .post(server.config.apiPath, nockDiff({
                    action: 'readinglists',
                    command: 'createentry',
                    list: '3',
                    batch: JSON.stringify(batchEntries),
                    token: csrfToken,
                    format: 'json',
                    formatversion: '2',
                }))
                .reply(200, {
                    createentry: {
                        ids: [2,3],
                        entries: [
                            {
                                id: 2,
                                project: server.config.defaultDomain,
                                title: 'Foobar',
                                created: '2018-08-30T13:44:04.276Z',
                                updated: '2018-08-30T13:44:04.276Z'
                            },
                            {
                                id: 3,
                                project: server.config.defaultDomain,
                                title: 'Dog',
                                created: '2018-08-30T13:44:04.276Z',
                                updated: '2018-08-30T13:44:04.276Z'
                            },
                        ],
                    },
                });

            return preq.post({
                uri: `${server.config.baseURL()}/data/lists/3/entries/batch`,
                query: {
                    csrf_token: csrfToken,
                },
                body: {
                    batch: batchEntries,
                },
                headers: {
                    'Cookie': sessionCookies,
                    'content-type': 'application/json',
                },
            })
            .finally(() => scope.done())
            .then((res) => {
                assert.deepEqual(res.status, 200);
                assert.deepEqual(res.body, {
                    batch: [
                        {
                            id: 2,
                        },
                        {
                            id: 3
                        },
                    ],
                    entries: [
                        {
                            id: 2,
                            project: server.config.defaultDomain,
                            title: 'Foobar',
                            created: '2018-08-30T13:44:04.276Z',
                            updated: '2018-08-30T13:44:04.276Z'
                        },
                        {
                            id: 3,
                            project: server.config.defaultDomain,
                            title: 'Dog',
                            created: '2018-08-30T13:44:04.276Z',
                            updated: '2018-08-30T13:44:04.276Z'
                        },
                    ],
                });
            });
        });
    });

    describe('GET /lists/pages/{project}/{title}', () => {
        const lists = [
            {
                id: 1,
                name: 'default',
                default: true,
                description: '',
                color: '',
                image: '',
                icon: '',
                created: '2017-09-27T06:59:13Z',
                updated: '2017-10-17T07:40:50Z',
                order: [ 1, 2, 3 ],
                listOrder: [ 1, 2 ],
            },
            {
                id: 2,
                name: 'other',
                description: '',
                color: '',
                image: '',
                icon: '',
                created: '2017-09-27T06:59:13Z',
                updated: '2017-10-17T07:40:50Z',
                order: [ 5, 4 ],
            },
        ];

        it('forward call', () => {
            const scope = getApi()
                .post(server.config.apiPath, nockDiff({
                    action: 'query',
                    meta: 'readinglists',
                    rlproject: server.config.defaultDomain,
                    rltitle: 'Foo_Bar',
                    rllimit: 'max',
                    format: 'json',
                    formatversion: '2',
                }))
                .reply(200, {
                    query: {
                        readinglists: lists,
                    },
                });

            return preq.get({
                uri: `${server.config.baseURL()}/data/lists/pages/${server.config.defaultDomain}/Foo%20Bar`,
                headers: {
                    'Cookie': sessionCookies,
                },
            })
            .finally(() => scope.done())
            .then((res) => {
                assert.deepEqual(res.status, 200);
                assert.deepEqual(res.body, {
                    lists,
                });
            });
        });

        it('paging', () => {
            const scope = getApi()
                .post(server.config.apiPath, nockDiff({
                    action: 'query',
                    meta: 'readinglists',
                    rlproject: server.config.defaultDomain,
                    rltitle: 'Foo_Bar',
                    rllimit: 'max',
                    format: 'json',
                    formatversion: '2',
                }))
                .reply(200, {
                    query: {
                        readinglists: lists.slice(0, 1),
                    },
                    continue: {
                        rlcontinue: 1,
                        continue: '-||',
                    },
                });

            return preq.get({
                uri: `${server.config.baseURL()}/data/lists/pages/${server.config.defaultDomain}/Foo%20Bar`,
                headers: {
                    'Cookie': sessionCookies,
                },
            })
            .finally(() => scope.done())
            .then((res) => {
                assert.deepEqual(res.status, 200);
                assert.deepEqual(res.body, {
                    lists: lists.slice(0, 1),
                    next: '{"rlcontinue":1,"continue":"-||"}',
                });
            });
        });

        it('paging 2', () => {
            const scope = getApi()
                .post(server.config.apiPath, nockDiff({
                    action: 'query',
                    meta: 'readinglists',
                    rlproject: server.config.defaultDomain,
                    rltitle: 'Foo_Bar',
                    rllimit: 'max',
                    rlcontinue: 1,
                    continue: '-||',
                    format: 'json',
                    formatversion: '2',
                }))
                .reply(200, {
                    query: {
                        readinglists: lists.slice(1),
                    },
                });

            return preq.get({
                uri: `${server.config.baseURL()}/data/lists/pages/${server.config.defaultDomain}/Foo%20Bar`,
                query: {
                    next: '{"rlcontinue":1,"continue":"-||"}',
                },
                headers: {
                    'Cookie': sessionCookies,
                },
            })
            .finally(() => scope.done())
            .then((res) => {
                assert.deepEqual(res.status, 200);
                assert.deepEqual(res.body, {
                    lists: lists.slice(1),
                });
            });
        });
    });

    describe('GET /lists/changes/since/{date}', () => {
        let lists;
        let entries;
        before(() => {
            lists = [
                {
                    id: 1,
                    name: 'default',
                    default: true,
                    description: '',
                    color: '',
                    image: '',
                    icon: '',
                    created: '2017-09-27T06:59:13Z',
                    updated: '2017-10-17T07:40:50Z',
                    order: [ 1, 2 ],
                    listOrder: [ 1, 2 ],
                },
                {
                    id: 2,
                    name: 'deleted',
                    description: '',
                    color: '',
                    image: '',
                    icon: '',
                    created: '2017-09-27T06:59:13Z',
                    updated: '2017-10-17T07:40:50Z',
                    deleted: true,
                },
            ];
            entries =  [
                {
                    id: 1,
                    listId: 1,
                    project: server.config.defaultDomain,
                    title: 'Foo Bar',
                    created: '2017-09-27T06:59:13Z',
                    updated: '2017-10-17T07:40:50Z',
                },
                {
                    id: 2,
                    listId: 1,
                    project: server.config.defaultDomain,
                    title: 'Boom Baz',
                    created: '2017-09-27T06:59:13Z',
                    updated: '2017-10-17T07:40:50Z',
                    deleted: true,
                },
            ];
        });

        it('forward call', () => {
            const scope = getApi()
                .post(server.config.apiPath, nockDiff({
                    action: 'query',
                    meta: 'readinglists',
                    list: 'readinglistentries',
                    rlchangedsince: '2017-10-15T00:00:00Z',
                    rlechangedsince: '2017-10-15T00:00:00Z',
                    rlsort: 'updated',
                    rlesort: 'updated',
                    rldir: 'ascending',
                    rledir: 'ascending',
                    rllimit: 'max',
                    rlelimit: 'max',
                    format: 'json',
                    formatversion: '2',
                }))
                .reply(200, {
                    query: {
                        readinglists: lists,
                        readinglistentries: entries,
                    },
                });

            return preq.get({
                uri: `${server.config.baseURL()}/data/lists/changes/since/2017-10-15T00%3A00%3A00Z`,
                headers: {
                    'Cookie': sessionCookies,
                },
            })
            .finally(() => scope.done())
            .then((res) => {
                res.body['continue-from'] = '<mock>';
                assert.deepEqual(res.status, 200);
                assert.deepEqual(res.body, {
                    lists,
                    entries,
                    'continue-from': '<mock>',
                });
            });
        });

        it('paging', () => {
            const scope = getApi()
                .post(server.config.apiPath, nockDiff({
                    action: 'query',
                    meta: 'readinglists',
                    list: 'readinglistentries',
                    rlchangedsince: '2017-10-15T00:00:00Z',
                    rlechangedsince: '2017-10-15T00:00:00Z',
                    rlsort: 'updated',
                    rlesort: 'updated',
                    rldir: 'ascending',
                    rledir: 'ascending',
                    rllimit: 'max',
                    rlelimit: 'max',
                    format: 'json',
                    formatversion: '2',
                }))
                .reply(200, {
                    query: {
                        readinglists: lists.slice(0, 1),
                        readinglistentries: entries.slice(0, 1),
                    },
                    continue: {
                        rlcontinue: 1,
                        rlecontinue: 1,
                        continue: '-||',
                    },
                });

            return preq.get({
                uri: `${server.config.baseURL()}/data/lists/changes/since/2017-10-15T00%3A00%3A00Z`,
                headers: {
                    'Cookie': sessionCookies,
                },
            })
            .finally(() => scope.done())
            .then((res) => {
                res.body['continue-from'] = '<mock>';
                assert.deepEqual(res.status, 200);
                assert.deepEqual(res.body, {
                    lists: lists.slice(0, 1),
                    entries: entries.slice(0, 1),
                    next: '{"rlcontinue":1,"rlecontinue":1,"continue":"-||"}',
                    'continue-from': '<mock>',
                });
            });
        });

        it('paging 2', () => {
            const scope = getApi()
                .post(server.config.apiPath, nockDiff({
                    action: 'query',
                    meta: 'readinglists',
                    list: 'readinglistentries',
                    rlchangedsince: '2017-10-15T00:00:00Z',
                    rlechangedsince: '2017-10-15T00:00:00Z',
                    rlsort: 'updated',
                    rlesort: 'updated',
                    rldir: 'ascending',
                    rledir: 'ascending',
                    rllimit: 'max',
                    rlelimit: 'max',
                    rlcontinue: 1,
                    rlecontinue: 1,
                    continue: '-||',
                    format: 'json',
                    formatversion: '2',
                }))
                .reply(200, {
                    query: {
                        readinglists: lists.slice(1),
                        readinglistentries: entries.slice(1),
                    },
                });

            return preq.get({
                uri: `${server.config.baseURL()}/data/lists/changes/since/2017-10-15T00%3A00%3A00Z`,
                query: {
                    next: '{"rlcontinue":1,"rlecontinue":1,"continue":"-||"}',
                },
                headers: {
                    'Cookie': sessionCookies,
                },
            })
            .finally(() => scope.done())
            .then((res) => {
                assert.deepEqual(res.status, 200);
                assert.deepEqual(res.body, {
                    lists: lists.slice(1),
                    entries: entries.slice(1),
                });
            });
        });
    });
});
