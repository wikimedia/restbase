"use strict";

const P = require('bluebird');
const HyperSwitch = require('hyperswitch');
const stringify = require('json-stable-stringify');
const mwUtils = require('../lib/mwUtil');

const URI = HyperSwitch.URI;
const spec = HyperSwitch.utils.loadSpec(`${__dirname}/mobileapps.yaml`);

class MobileApps {
    constructor(options) {
        this._options = options || {};
        this._options.storage = this._options.storage || 'both';
    }

    _isNull(x) {
        return x === undefined || x === null;
    }

    _isSimpleType(x) {
        if (this._isNull(x)) {
            return true;
        }
        if (x.constructor === Object || Array.isArray(x)) {
            return false;
        }
        return true;
    }

    /* eslint-disable */
    /* jshint ignore:start */
    _getDiff(oldPart, newPart, path = '') {
        let result = [];
        if (this._isNull(oldPart) || this._isNull(newPart) ||
                (this._isSimpleType(oldPart) && this._isSimpleType(newPart))) {
            if (oldPart != newPart) {
                return [{
                    path,
                    msg: 'simple value mispatch',
                    old_value: this._isNull(oldPart) ? '' :
                        (this._isSimpleType(oldPart) ? oldPart : oldPart.constructor.name),
                    new_value: this._isNull(newPart) ? '' :
                        (this._isSimpleType(newPart) ? newPart : newPart.constructor.name),
                }];
            }
            return [];
        }
        if (Array.isArray(oldPart) || Array.isArray(newPart)) {
            if (!Array.isArray(oldPart) || !Array.isArray(newPart)
                    || oldPart.length != newPart.length) {
                return [{
                    path,
                    msg: 'array length or type mismatch',
                    old_array_len: Array.isArray(oldPart) ? oldPart.length : 0,
                    new_array_len: Array.isArray(newPart) ? newPart.length : 0
                }];
            }
            for (let i = 0; i < oldPart.length; i++) {
                let found = false;
                for (let j = 0; j < newPart.length; j++) {
                    const minires = this._getDiff(oldPart[i], newPart[j], `${path}[${i}]`);
                    if (minires.length === 0) {
                        found = true;
                        break;
                    }
                }
                if (!found) {
                    result.push({
                        path: `${path}[${i}]`,
                        msg: 'element not found in the new bucket',
                        old_value: this._isSimpleType(oldPart[i]) ? oldPart :
                            (Array.isArray(oldPart[i]) ? `array[${oldPart[i].length}]` :
                                Object.keys(oldPart[i]))
                    });
                }
            }
            return result;
        }
        if (!oldPart.constructor === Object || !newPart.constructor === Object) {
            return [{
                path,
                msg: 'object type mismatch',
                old_type: oldPart.constructor.name,
                new_type: newPart.constructor.name
            }];
        }
        const oldKeys = Object.keys(oldPart).sort();
        const newKeys = Object.keys(newPart).sort();
        if (oldKeys.length !== newKeys.length) {
            return [{
                path,
                msg: 'difference in object keys',
                old_keys: oldKeys,
                new_keys: newKeys,
                diff_keys: oldKeys.filter(item => !newKeys.includes(item))
            }];
        }
        oldKeys.forEach((key) => {
            result = result.concat(this._getDiff(oldPart[key], newPart[key], `${path}.${key}`));
        });
        return result;
    }
    /* jshint ignore:end */
    /* eslint-enable */

    _generateDoubleFetching(hyper, req, oldPath, newPath) {
        return P.join(
            hyper.get({
                uri: new URI(oldPath),
                headers: req.headers
            })
            .catch((e) => {
                hyper.log('error/mobileapps', {
                    message: 'Error fetching old mobile content',
                    error: e
                });
                throw e;
            }),
            hyper.get({
                uri: new URI(newPath),
                headers: req.headers
            })
            .catch((e) => {
                hyper.log('error/mobileapps', {
                    message: 'Error fetching new mobile content',
                    error: e
                });
            })
        )
        .then((results) => {
            const oldBucket = results[0];
            const newBucket = results[1];

            // Only check it for update requests - the new storage is empty so
            // new renders are done from scratch, so comparing makes no sence as
            // templates might be dynamic.
            if (mwUtils.isNoCacheRequest(req) && oldBucket && newBucket) {
                const oldBody = oldBucket.body;
                const newBody = newBucket.body;
                if (stringify(oldBody) !== stringify(newBody)) {
                    let diff;
                    try {
                        diff = this._getDiff(oldBody, newBody);
                    } catch (e) {
                        diff = [{ msg: 'failed to compute the diff' }];
                    }
                    if (diff.length) {
                        hyper.log('error/mobileapps/mismatch', {
                            message: 'Content mismatch between old and new bucket',
                            old_etag: oldBucket.headers.etag,
                            new_etag: newBucket.headers.etag,
                            diff
                        });
                    }
                }
            }

            // TODO: Even more logging!
            return oldBucket || newBucket;
        });
    }

    getSections(hyper, req) {
        const rp = req.params;
        const oldPath = [rp.domain, 'sys', 'mobileapps_old', 'mobile-sections', rp.title];
        if (rp.revision) {
            oldPath.push(rp.revision);
        }
        const newPath = [rp.domain, 'sys', 'mobileapps_new', 'mobile-sections', rp.title];
        if (rp.revision) {
            newPath.push(rp.revision);
        }
        if (this._options.storage === 'new') {
            return hyper.get({
                uri: new URI(newPath),
                headers: req.headers
            });
        }
        if (this._options.storage === 'old') {
            return hyper.get({
                uri: new URI(oldPath),
                headers: req.headers
            });
        }
        return this._generateDoubleFetching(hyper, req, oldPath, newPath);
    }

    getPart(part, hyper, req) {
        const rp = req.params;
        const oldPath = [rp.domain, 'sys', 'mobileapps_old', `mobile-sections-${part}`, rp.title];
        if (rp.revision) {
            oldPath.push(rp.revision);
        }
        const newPath = [rp.domain, 'sys', 'mobileapps_new', `mobile-sections-${part}`, rp.title];
        if (rp.revision) {
            newPath.push(rp.revision);
        }
        if (this._options.storage === 'new') {
            return hyper.get({
                uri: new URI(newPath),
                headers: req.headers
            });
        }
        if (this._options.storage === 'old') {
            return hyper.get({
                uri: new URI(oldPath),
                headers: req.headers
            });
        }
        return this._generateDoubleFetching(hyper, req, oldPath, newPath);
    }
}

module.exports = (options) => {
    const mobileApps = new MobileApps(options);

    return {
        spec,
        operations: {
            getSections: mobileApps.getSections.bind(mobileApps),
            getSectionsLead: mobileApps.getPart.bind(mobileApps, 'lead'),
            getSectionsRemaining: mobileApps.getPart.bind(mobileApps, 'remaining')
        }
    };
};
