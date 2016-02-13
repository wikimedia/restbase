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
                    done();
                }
            } catch (e) {
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
});