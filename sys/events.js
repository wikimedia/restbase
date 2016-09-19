"use strict";

var P         = require('bluebird');
var HTTPError = require('hyperswitch').HTTPError;
var uuid = require('cassandra-uuid').TimeUuid;

var EventService = function(options) {
    if (options && options.eventlogging_service) {
        // TODO: remove eventually
        // keep compat with old config
        options = options.eventlogging_service;
    }
    if (options && options.purge) {
        // TODO: remove eventually
        // disregard old-config purge stanzas
        options.purge = undefined;
    }
    this.options = options;
};

EventService.prototype.emitEvent = function(hyper, req) {
    var self = this;
    if (!(self.options && self.options.uri && self.options.topic)) {
        return { status: 200 };
    }
    return P.try(function() {
        // Change-propagation will set up the x-triggered-by header, indicating
        // the event which caused the rerender. In case RESTBase is about to emit
        // the same event, it will cause a rerender loop. So, log an error and skip
        // the event.
        var triggeredBy = req.headers && req.headers['x-triggered-by']
            || hyper._rootReq && hyper._rootReq['x-triggered-by'];
        var topic = self.options.topic;
        if (triggeredBy && /transcludes/.test(triggeredBy)) {
            topic = self.options.transcludes_topic;
        }

        var events = req.body.map(function(event) {
            if (!event.meta || !event.meta.uri || !/^\/\//.test(event.meta.uri)) {
                hyper.log('error/events/emit', {
                    message: 'Invalid event URI',
                    event: event
                });
                return undefined;
            }
            event.meta.uri = 'http:' + event.meta.uri;
            event.meta.topic = topic;
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

        if (triggeredBy) {
            triggeredBy = triggeredBy.replace(/https?:/g, '');
            events = events.filter(function(event) {
                var eventId = event.meta.topic + ':' + event.meta.uri.replace(/^https?:/, '');
                if (triggeredBy.indexOf(eventId) !== -1) {
                    hyper.log('error/events/rerender_loop', {
                        message: 'Rerender loop detected',
                        event: event
                    });
                    return false;
                }
                return true;
            });
        }

        if (events && events.length) {
            if (self.options.skip_updates) {
                return P.resolve();
            }
            return hyper.post({
                uri: self.options.uri,
                headers: {
                    'content-type': 'application/json'
                },
                body: events
            });
        }
    })
    .catch(function(e) {
        hyper.log('error/events/emit', e);
    }).thenReturn({ status: 200 });
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
