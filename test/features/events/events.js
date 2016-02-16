"use strict";

var dgram = require('dgram');
var preq   = require('preq');

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
                    [ '//en.wikipedia.org/api/rest_v1/page/mobile-sections-lead/Test',
                        '//en.wikipedia.org/api/rest_v1/page/mobile-sections-remaining/Test',
                        '//en.wikipedia.org/api/rest_v1/page/mobile-sections/Test' ]);
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
            uri: server.config.bucketURL + '/mobile-sections/Test',
            headers: {
                'cache-control': 'no-cache'
            }
        })
        .delay(100)
        .finally(function() {
            udpServer.close();
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
            uri: server.config.baseURL + '/events/',
            body: { uri: '//en.wikipedia.org' }
        });
    });

    it('should send valid events and drop invalid', function(done) {
        var udpServer = dgram.createSocket('udp4');

        udpServer.on("message", function(msg) {
            try {
                var uri = msg.slice(22, 22 + msg.readInt16BE(20)).toString();
                assert.deepEqual(uri, '//en.wikipedia.org');
                udpServer.close();
                done();
            } catch (e) {
                udpServer.close();
                done(e);
            }
        });
        udpServer.bind(4321);

        return preq.post({
            uri: server.config.baseURL + '/events/',
            headers: {
                'content-type': 'application/json'
            },
            body: [
                { uri: '//en.wikipedia.org' },
                { should_not_be: 'here' }
            ]
        })
        .delay(100)
        .finally(function() {
            udpServer.close();
        });
    });
});