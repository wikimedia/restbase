"use strict";

var Purger = require('htcp-purge');
var P      = require('bluebird');

var EventService = function(options) {
    this.options = options;

    if (options && options.host && options.port) {
        this.purger = new Purger({ routes: [ options ] });
    }
};

EventService.prototype.emitEvent = function(hyper, req) {
    var self = this;
    if (this.purger) {
        self.purger.purge(req.body.map(function(event) {
            return event.uri.toString();
        }))
        .catch(function(e) {
            hyper.log('error/purge', e);
        });
    }
    return P.resolve({ status: 200 });
};

module.exports = function(options) {
    var es = new EventService(options);

    return {
        spec: {
            paths: {
                '/': {
                    post: {
                        operationId: 'emitEvent'
                    }
                }
            }
        },
        operations: {
            emitEvent: es.emitEvent.bind(es)
        }
    };
};