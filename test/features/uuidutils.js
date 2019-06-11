'use strict';

/**
 * Unit tests for uuid helper methods
 */

// require('uuid') deprecated with version 3.x
const uuidv1 = require('uuid/v1');
const uuidv3 = require('uuid/v3');
const uuidv4 = require('uuid/v4');
const uuidv5 = require('uuid/v5');

const uuidUtils = require('../../lib/uuidUtils');
const assert = require('../utils/assert');

describe('UUID Utils', () => {
    const orig_time = Date.parse('04 Dec 1995 00:12:00 GMT');

    it('Should retrieve the correct time from UUID v1', () => {
        const uuid_time = uuidUtils.getTime(uuidv1({msecs: orig_time}));
        assert.deepEqual(uuid_time, orig_time);
    });

    it('Should retrieve the correct date from UUID v1', () => {
        const orig_dt = new Date(orig_time);
        const uuid_dt = uuidUtils.getDate(uuidv1({msecs: orig_time}));
        assert.deepEqual(uuid_dt, orig_dt);
    });

    it('Should validate all UUID versions', () => {
        const MY_NAMESPACE = uuidv4();
        const uuids = [uuidv1(), uuidv3('MY_NAME', MY_NAMESPACE), 
            uuidv4(), uuidv5('MY_NAME', MY_NAMESPACE)];

        uuids.forEach(u => {
            assert.deepEqual(uuidUtils.test(u), true);
        });
    });
});

