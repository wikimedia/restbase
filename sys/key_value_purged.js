"use strict";


const HyperSwitch = require('hyperswitch');
const stringify = require('json-stable-stringify');

const URI = HyperSwitch.URI;
const Template = HyperSwitch.Template;
const HTTPError = HyperSwitch.HTTPError;

const spec = HyperSwitch.utils.loadSpec(`${__dirname}/key_value.yaml`);

class KVBucket {
    createBucket(hyper, req) {
        if (req.body.purge_template) {
            this._purgeTemplate = new Template(req.body.purge_template);
        }
        req.body.purge_template = undefined;

        return hyper.put({
            uri: new URI([req.params.domain, 'sys', 'key_value', req.params.bucket]),
            headers: req.headers,
            body: req.body
        });
    }

    getRevision(hyper, req) {
        const uri = [req.params.domain, 'sys', 'key_value', req.params.bucket, req.params.key];
        if (req.params.tid) {
            uri.push(req.params.tid);
        }
        return hyper.get({
            uri: new URI(uri),
            headers: req.headers,
            body: req.body
        });
    }


    listRevisions(hyper, req) {
        return hyper.get({
            uri: new URI([req.params.domain, 'sys', 'key_value',
                req.params.bucket, req.params.key, '']),
            headers: req.headers,
            query: req.query,
            body: req.body
        });
    }


    putRevision(hyper, req) {
        const fetchUriPath = [req.params.domain, 'sys', 'key_value',
            req.params.bucket, req.params.key];
        return hyper.get({ uri: new URI(fetchUriPath) })
        .then((oldContent) => {
            if (stringify(req.body) === stringify(oldContent.body)
                    && req.headers['content-type'] === oldContent.headers['content-type']) {
                hyper.metrics.increment(`sys_kv_${req.params.bucket}.unchanged_rev_render`);
                return { status: 200 };
            } else {
                throw new HTTPError({
                    status: 404
                });
            }
        })
        .catch({ status: 404 }, () => {
            const newPutPath = [req.params.domain, 'sys', 'key_value',
                req.params.bucket, req.params.key];
            if (req.params.tid) {
                newPutPath.push(req.params.tid);
            }

            return hyper.put({
                uri: new URI(newPutPath),
                headers: req.headers,
                body: req.body
            })
            .tap(() =>  {
                if (this._purgeTemplate) {
                    return hyper.request(this._purgeTemplate.expand({ request: req }));
                }
            });
        });
    }
}

module.exports = (options) => {
    const kvBucket = new KVBucket(options);

    return {
        spec, // Re-export from spec module
        operations: {
            createBucket: kvBucket.createBucket.bind(kvBucket),
            listRevisions: kvBucket.listRevisions.bind(kvBucket),
            getRevision: kvBucket.getRevision.bind(kvBucket),
            putRevision: kvBucket.putRevision.bind(kvBucket)
        }
    };
};
