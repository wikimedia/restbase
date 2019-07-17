'use strict';

const P         = require('bluebird');
const uuidv1 = require('uuid/v1');

class EventService {
    constructor(options) {
        this.options = options;
    }

    emitEvent(hyper, req) {
        if (!(this.options && this.options.uri && this.options.stream)) {
            return { status: 200 };
        }
        return P.try(() => {
            // Change-propagation will set up the x-triggered-by header, indicating
            // the event which caused the rerender. In case RESTBase is about to emit
            // the same event, it will cause a rerender loop. So, log an error and skip
            // the event.
            let triggeredBy = req.headers && req.headers['x-triggered-by'] ||
                hyper._rootReq && hyper._rootReq.headers &&
                    hyper._rootReq.headers['x-triggered-by'];
            let stream = this.options.stream;
            if (triggeredBy && this.options.transcludes_stream &&
                    /transcludes/.test(triggeredBy)) {
                stream = this.options.transcludes_stream;
            }

            let events = req.body.map((event) => {
                if (!event.meta || !event.meta.uri || !/^\/\//.test(event.meta.uri)) {
                    hyper.logger.log('error/events/emit', {
                        message: 'Invalid event URI',
                        event
                    });
                    return undefined;
                }
                event.$schema = '/resource_change/1.0.0';
                event.meta.uri = `http:${event.meta.uri}`;
                event.meta.stream = stream;
                event.meta.request_id = hyper.reqId;
                event.meta.id = uuidv1();
                event.meta.dt = new Date().toISOString();
                event.meta.domain = req.params.domain;
                event.tags = event.tags || [];
                if (event.tags.indexOf('restbase') < 0) {
                    event.tags.push('restbase');
                }
                event.triggered_by = triggeredBy;
                return event;
            })
            .filter((event) => !!event);

            if (triggeredBy) {
                triggeredBy = triggeredBy.replace(/https?:/g, '');
                events = events.filter((event) => {
                    const eventId = `${event.meta.stream}:${event.meta.uri.replace(/^https?:/, '')}`;
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
