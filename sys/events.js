"use strict";

const P         = require('bluebird');
const uuid = require('cassandra-uuid').TimeUuid;

class EventService {
    constructor(options) {
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
    }

    emitEvent(hyper, req) {
        if (!(this.options && this.options.uri && this.options.topic)) {
            return { status: 200 };
        }
        return P.try(() => {
            // Change-propagation will set up the x-triggered-by header, indicating
            // the event which caused the rerender. In case RESTBase is about to emit
            // the same event, it will cause a rerender loop. So, log an error and skip
            // the event.
            let triggeredBy = req.headers && req.headers['x-triggered-by']
                || hyper._rootReq && hyper._rootReq.headers
                    && hyper._rootReq.headers['x-triggered-by'];
            let topic = this.options.topic;
            if (triggeredBy && this.options.transcludes_topic
                    && /transcludes/.test(triggeredBy)) {
                topic = this.options.transcludes_topic;
            }

            let events = req.body.map((event) => {
                if (!event.meta || !event.meta.uri || !/^\/\//.test(event.meta.uri)) {
                    hyper.logger.log('error/events/emit', {
                        message: 'Invalid event URI',
                        event
                    });
                    return undefined;
                }
                event.meta.uri = `http:${event.meta.uri}`;
                event.meta.topic = topic;
                event.meta.request_id = hyper.reqId;
                event.meta.id = uuid.now().toString();
                event.meta.dt = new Date().toISOString();
                event.meta.domain = req.params.domain;
                event.tags = event.tags || [];
                if (event.tags.indexOf('restbase') < 0) {
                    event.tags.push('restbase');
                }
                event.triggered_by = triggeredBy;
                return event;
            })
            .filter(event => !!event);

            if (triggeredBy) {
                triggeredBy = triggeredBy.replace(/https?:/g, '');
                events = events.filter((event) => {
                    const eventId = `${event.meta.topic}:${event.meta.uri.replace(/^https?:/, '')}`;
                    if (triggeredBy.indexOf(eventId) !== -1) {
                        hyper.logger.log('error/events/rerender_loop', {
                            message: 'Rerender loop detected',
                            event
                        });
                        return false;
                    }
                    return true;
                });
            }

            if (events && events.length) {
                if (this.options.skip_updates) {
                    return P.resolve();
                }
                return hyper.post({
                    uri: this.options.uri,
                    headers: {
                        'content-type': 'application/json'
                    },
                    body: events
                });
            }
        })
        .catch((e) => {
            hyper.logger.log('error/events/emit', e);
        }).thenReturn({ status: 200 });
    }
}

module.exports = (options) => {
    const es = new EventService(options);

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
