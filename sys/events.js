"use strict";

var Purger    = require('htcp-purge');
var P         = require('bluebird');
var HTTPError = require('hyperswitch').HTTPError;

var EventService = function(options) {
    this.options = options;

    if (options && options.purge) {
        this.purger = new Purger({ routes: [ options.purge ] });
    }
};

EventService.prototype.emitEvent = function(hyper, req) {
    var self = this;
    if (this.purger) {
        P.try(function() {
            if (!Array.isArray(req.body)) {
                throw new HTTPError({
                    status: 400,
                    body: {
                        type: 'events',
                        description: 'Invalid request for event service.'
                    }
                });
            }

            return self.purger.purge(req.body.map(function(event) {
                if (!event.meta || !event.meta.uri) {
                    hyper.log('error/events/purge', {
                        message: 'Invalid event URI',
                        event: event
                    });
                } else {
                    var uri = event.meta.uri.toString();
                    if (!/^https?:/.test(uri)) {
                        uri = 'http:' + uri;
                    }
                    return uri;
                }
            })
            .filter(function(event) { return !!event; }));
        })
        .catch(function(e) {
            hyper.log('error/events/purge', e);
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