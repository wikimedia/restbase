'use strict';

const preq   = require('preq');
const http   = require('http');
const uuidUtils   = require('../../../lib/uuidUtils');

const Server = require('../../utils/server.js');
const assert = require('../../utils/assert.js');

describe('Change event emitting', () => {
    const server = new Server();
    before(() => server.start());
    after(() => server.stop());

    it('should not explode if events config is not provided', () => {
        return preq.post({
            uri: `${server.config.baseURL('fake.wikipedia.org')}/events_no_config/`,
            body: [
                { uri: '//fake.wikipedia.org' }
            ]
        });
    });

    function createEventLogging(done, eventOptions) {
        const eventLogging = http.createServer((request) => {
            try {
                assert.deepEqual(request.method, 'POST');
                let postData;
                request.on('data', (data) => {
                    postData = postData ? Buffer.concat(postData, data) : data;
                });
                request.on('end', () => {
                    try {
                        const events = JSON.parse(postData.toString());
                        assert.deepEqual(events.length, 1);
                        const event = events[0];
                        assert.deepEqual(event.meta.domain, 'fake.wikipedia.org');
                        assert.deepEqual(!!new Date(event.meta.dt), true);
                        assert.deepEqual(uuidUtils.test(event.meta.id), true);
                        assert.deepEqual(uuidUtils.test(event.meta.request_id), true);
                        assert.deepEqual(event.meta.topic, eventOptions.topic);
                        assert.deepEqual(event.meta.uri, eventOptions.uri);
                        assert.deepEqual(event.tags, ['test', 'restbase']);
                        if (eventOptions.trigger) {
                            assert.deepEqual(event.triggered_by, eventOptions.trigger);
                        }
                        done();
                    } catch (e) {
                        done(e);
                    }
                });
            } catch (e) {
                done(e);
            }
        });
        eventLogging.on('error', done);
        eventLogging.listen(8085);
        return eventLogging;
    }

    it('should send correct events to the service', (done) => {
        let eventLogging;

        function really_done(e) {
            if (eventLogging) {
                eventLogging.close();
                eventLogging = undefined;
                done(e);
            }
        }

        eventLogging = createEventLogging(really_done, {
            topic: 'resource_change',
            uri: 'http://fake.wikipedia.org/wiki/User:Pchelolo'
        });

        preq.post({
            uri: `${server.config.baseURL('fake.wikipedia.org')}/events/`,
            headers: {
                'content-type': 'application/json',
                connection: 'close',
            },
            body: [
                {
                    meta: {
                        uri: '//fake.wikipedia.org/wiki/User:Pchelolo'
                    },
                    tags: ['test']
                },
                { meta: {} },
                { should_not_be: 'here' }
            ]
        })
        .delay(20000)
        .finally(() => {
            really_done(new Error('HTTP event server timeout!'));
        });
    });

    it('should send correct events to the service, transcludes', (done) => {
        let eventLogging;

        function really_done(e) {
            if (eventLogging) {
                eventLogging.close();
                eventLogging = undefined;
                done(e);
            }
        }

        eventLogging = createEventLogging(really_done, {
            topic: 'change-prop.transcludes.resource-change',
            uri: 'http://fake.wikipedia.org/api/rest_v1/page/html/User:Pchelolo',
            trigger: 'mediawiki.revision-create:https://en.wikimedia.org/wiki/Template:One,change-prop.transcludes.resource-change:https://fake.wikipedia.org/wiki/User:Pchelolo'
        });

        preq.post({
            uri: `${server.config.baseURL('fake.wikipedia.org')}/events/`,
            headers: {
                'content-type': 'application/json',
                connection: 'close',
                'x-triggered-by': 'mediawiki.revision-create:https://en.wikimedia.org/wiki/Template:One,change-prop.transcludes.resource-change:https://fake.wikipedia.org/wiki/User:Pchelolo'
            },
            body: [
                {
                    meta: {
                        uri: '//fake.wikipedia.org/api/rest_v1/page/html/User:Pchelolo'
                    },
                    tags: ['test']
                }
            ]
        })
        .delay(20000)
        .finally(() => {
            really_done(new Error('HTTP event server timeout!'));
        });
    });

    it('Should skip event if it will cause a loop', (done) => {
        let eventLogging;

        function really_done(e) {
            if (eventLogging) {
                eventLogging.close();
                eventLogging = undefined;
                done(e);
            }
        }

        eventLogging = createEventLogging(really_done, {
            topic: 'resource_change',
            uri: 'http://fake.wikipedia.org/wiki/User:Pchelolo',
            trigger: 'resource_change:https://fake.wikipedia.org/wiki/Prohibited'
        });

        preq.post({
            uri: `${server.config.baseURL('fake.wikipedia.org')}/events/`,
            headers: {
                'content-type': 'application/json',
                'x-triggered-by': 'resource_change:https://fake.wikipedia.org/wiki/Prohibited'
            },
            body: [
                {
                    meta: {
                        uri: '//fake.wikipedia.org/wiki/Prohibited'
                    },
                    tags: ['test']
                },
                {
                    meta: {
                        uri: '//fake.wikipedia.org/wiki/User:Pchelolo'
                    },
                    tags: ['test']
                }
            ]
        })
        .delay(20000)
        .finally(() => {
            really_done(new Error('HTTP event server timeout!'));
        });
    });
});
