"use strict";

var dgram  = require('dgram');
var preq   = require('preq');
var http   = require('http');
var uuid   = require('cassandra-uuid').TimeUuid;

var server = require('../../utils/server.js');
var assert = require('../../utils/assert.js');

describe('Change event emitting', function() {

    before(function () { return server.start(); });

    it('should purge caches on mobileapps update', function(done) {
        var udpServer = dgram.createSocket('udp4');

        var receivedMessages = [];
        udpServer.on("message", function(msg) {
            try {
                receivedMessages.push(msg);
                if (receivedMessages.length === 3) {
                    receivedMessages = receivedMessages.map(function(message) {
                        return message.slice(22, 22 + message.readInt16BE(20)).toString();
                    }).sort();
                    assert.deepEqual(receivedMessages,
                    [ 'http://en.wikipedia.org/api/rest_v1/page/mobile-sections-lead/User%3APchelolo',
                        'http://en.wikipedia.org/api/rest_v1/page/mobile-sections-remaining/User%3APchelolo',
                        'http://en.wikipedia.org/api/rest_v1/page/mobile-sections/User%3APchelolo' ]);
                    udpServer.close();
                    done();
                }
            } catch (e) {
                udpServer.close();
                done(e);
            }
        });
        udpServer.bind(4321);

        return preq.get({
            uri: server.config.bucketURL + '/mobile-sections/User:Pchelolo',
            headers: {
                'cache-control': 'no-cache'
            }
        })
        .delay(100)
        .finally(function() {
            udpServer.close();
            done(new Error('Timeout!'));
        });
    });

    it('should not explode if events config is not provided', function() {
        return preq.post({
            uri: server.config.baseURL + '/events_no_config/',
            body: [
                { uri: '//en.wikipedia.org' }
            ]
        });
    });

    it('should not explode on incorrect body', function() {
        return preq.post({
            uri: server.config.baseURL + '/events_purge/',
            body: { uri: '//en.wikipedia.org' }
        });
    });

    it('should send valid events and drop invalid', function(done) {
        var udpServer = dgram.createSocket('udp4');

        udpServer.on("message", function(msg) {
            try {
                var uri = msg.slice(22, 22 + msg.readInt16BE(20)).toString();
                assert.deepEqual(uri, 'http://en.wikipedia.org');
                udpServer.close();
                done();
            } catch (e) {
                udpServer.close();
                done(e);
            }
        });
        udpServer.bind(4321);

        return preq.post({
            uri: server.config.baseURL + '/events_purge/',
            headers: {
                'content-type': 'application/json'
            },
            body: [
                { meta: {
                        uri: '//en.wikipedia.org'
                    }
                },
                { meta: { } },
                { should_not_be: 'here' }
            ]
        })
        .delay(100)
        .finally(function() {
            udpServer.close();
            done(new Error('Timeout!'));
        });
    });

    it('should send correct events to the service', function(done) {
        var eventLogging;

        function really_done(e) {
            if (eventLogging) eventLogging.close();
            done(e)
        }

        try {
            eventLogging = http.createServer(function(request) {
                try {
                    assert.deepEqual(request.method, 'POST');
                    var postData;
                    request.on('data', function(data) {
                        postData = postData ? Buffer.concat(postData, data) : data;
                    });
                    request.on('end', function() {
                        try {
                            var events = JSON.parse(postData.toString());
                            assert.deepEqual(events.length, 1);
                            var event = events[0];
                            assert.deepEqual(event.meta.domain, 'en.wikipedia.org');
                            assert.deepEqual(!!new Date(event.meta.dt), true);
                            assert.deepEqual(uuid.test(event.meta.id), true);
                            assert.deepEqual(!!event.meta.request_id, true);
                            assert.deepEqual(event.meta.topic, 'wmf.resource_change');
                            assert.deepEqual(event.meta.uri, 'http://en.wikipedia.org/wiki/User:Pchelolo');
                            assert.deepEqual(event.tags, ['test', 'restbase']);
                            really_done();
                        } catch (e) {
                            really_done(e);
                        }
                    });
                } catch (e) {
                    really_done(e);
                }
            });
            eventLogging.on('error', done);
            eventLogging.listen(8085);
        } catch (e) {
            really_done(e);
        }

        return preq.post({
            uri: server.config.baseURL + '/events_emit/',
            headers: {
                'content-type': 'application/json'
            },
            body: [
                {
                    meta: {
                        uri: '//en.wikipedia.org/wiki/User:Pchelolo'
                    },
                    tags: ['test']
                },
                {meta: {}},
                {should_not_be: 'here'}
            ]
        })
        .delay(100)
        .finally(function() {
            really_done(new Error('Timeout!'));
        });
    });
});