'use strict';

const uuidRegEx = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

const uuidUtils = {};

uuidUtils.V1_EPOCH_OFFSET = 122192928000000000; //  100 nanosecond intervals since 15 October 1582

/**
 * Extract time in nanoseconds from UUID V1
 *
 * @param {string} uuidv1
 * @return {number|null}
 *
 */
uuidUtils.getTimeInNs = (uuidv1) => {
    if (!(typeof uuidv1 === 'string' || uuidv1 instanceof String)) {
        return undefined;
    }

    const uuidComponents = uuidv1.split('-');
    return parseInt(
        [
            uuidComponents[2].substring(1),
            uuidComponents[1],
            uuidComponents[0]
        ].join(''), 16);
};

/**
 * Extract time in microseconds from UUID V1
 *
 * @param {string} uuidv1
 * @return {number|undefined}
 *
 */
uuidUtils.getTime = (uuidv1) => {
    const timeInNs = uuidUtils.getTimeInNs(uuidv1);
    // Convert ns intervals to ms since Jan 1 1970
    return timeInNs ? Math.floor((timeInNs - uuidUtils.V1_EPOCH_OFFSET) / 10000) : undefined;
};

/**
 * Extract date from UUID V1
 *
 * @param {string} uuidv1
 * @return {Date|undefined}
 *
 */
uuidUtils.getDate = (uuidv1) => {
    const timeInMs = uuidUtils.getTime(uuidv1);
    return timeInMs ? new Date(timeInMs) : undefined;
};

/**
 * Validate UUID
 *
 * @param {string} uuid
 * @return {boolean}
 *
 */
uuidUtils.test = (uuid) => {
    if (!(typeof uuid === 'string' || uuid instanceof String)) {
        return false;
    }

    return uuidRegEx.test(uuid);
};

module.exports = uuidUtils;
