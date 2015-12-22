"use strict";


/*
 * Static utility methods
 */

var uuid = require('cassandra-uuid').TimeUuid;

var utils = {};

/**
 * Generates a new request ID
 * @returns {String} v1 UUID for the request
 */
utils.generateRequestId = function() {
    return uuid.now().toString();
};

module.exports = utils;
