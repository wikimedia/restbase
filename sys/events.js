"use strict";

var Purger    = require('htcp-purge');
var P         = require('bluebird');
var HTTPError = require('hyperswitch').HTTPError;
var uuid = require('cassandra-uuid').TimeUuid;

var EventService = function(options) {
    this.options = options;

    if (options && options.eventlogging_service
        && !options.eventlogging_service.uri) {
        throw new Error('Incorrect configuration of events module. ' +
            'EventLogging options should provide a uri');
    }

    if (options && options.eventlogging_service
        && !options.eventlogging_service.topic) {
        throw new Error('Incorrect configuration of events module. ' +
            'EventLogging options should provide a topic');
    }

    if (options && options.purge) {
        this.purger = new Purger({ routes: [ options.purge ] });
    }
};

// Until the change propagation is in place we purge straight from
// RESTBase, however after it's implemented we'd remove this and only emit
// an event to the eventlogging service
EventService.prototype._purge = function(hyper, req) {
    var self = this;
    if (this.purger) {
        P.try(function() {
            if (!Array.isArray(req.body)) {
                throw new HTTPError({
                    status: 400,
                    body: {
                        type: 'bad_request',
                        description: 'Invalid request for event service.'
                    }
                });
            }

            return self.purger.purge(req.body.map(function(event) {
                if (!event.meta || !event.meta.uri || !/^\/\//.test(event.meta.uri)) {
                    hyper.log('error/events/purge', {
                        message: 'Invalid event URI',
                        event: event
                    });
                } else {
                    return 'http:' + event.meta.uri;
                }
            })
            .filter(function(event) { return !!event; }));
        })
        .catch(function(e) {
            hyper.log('error/events/purge', e);
        });
    }
};

EventService.prototype._emit = function(hyper, req) {
    var self = this;
    if (self.options && self.options.eventlogging_service) {
        return P.try(function() {
            var events = req.body.map(function(event) {
                if (!event.meta || !event.meta.uri || !/^\/\//.test(event.meta.uri)) {
                    hyper.log('error/events/emit', {
                        message: 'Invalid event URI',
                        event: event
                    });
                    return undefined;
                }
                event.meta.uri = 'http:' + event.meta.uri;
                event.meta.topic = self.options.eventlogging_service.topic;
                event.meta.request_id = hyper.reqId;
                event.meta.id = uuid.now().toString();
                event.meta.dt = new Date().toISOString();
                event.meta.domain = req.params.domain;
                event.tags = event.tags || [];
                if (event.tags.indexOf('restbase') < 0) {
                    event.tags.push('restbase');
                }
                return event;
            })
            .filter(function(event) { return !!event; });
            if (events && events.length) {
                return hyper.post({
                    uri: self.options.eventlogging_service.uri,
                    headers: {
                        'content-type': 'application/json'
                    },
                    body: events
                });
            }
        })
        .catch(function(e) {
            hyper.log('error/events/emit', e);
        });
    }
};

EventService.prototype.emitEvent = function(hyper, req) {
    return P.join(
        this._purge(hyper, req),
        this._emit(hyper, req)
    ).thenReturn({ status: 200 });
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