'use strict';

const HyperSwitch = require('hyperswitch');
const spec = HyperSwitch.utils.loadSpec(`${__dirname}/lists.yaml`);

module.exports = options => ({
    spec,
    globals: {
        options,
        /**
         * Transform the continuation data into a string so it is easier for clients to deal with.
         * @param {!Object|undefined} continuation Continuation object returned by the
         *   MediaWiki API.
         * @return {!String|undefined} Continuation string.
         */
        flattenContinuation(continuation) {
            return JSON.stringify(continuation);
        },
        /**
         * Inverse of flattenContinuation.
         * @param {!String|undefined} continuation Continuation string
         *   returned by flattenContinuation().
         * @return {!Object} Continuation object.
         */
        unflattenContinuation(continuation) {
            const sanitizedContinuation = {};
            if ( typeof continuation === 'string' ) {
                try {
                    continuation = JSON.parse(continuation);
                } catch (e) {
                    this.options.log('error/unflatten', {
                        msg: e.stack,
                        json: continuation,
                    });
                    throw e;
                }
                // Make sure nothing malicious can be done by splicing the continuation data
                // into the API parameters.
                const allowedKeys = ['continue', 'rlcontinue', 'rlecontinue'];
                for (let key of allowedKeys) {
                    if (typeof continuation[key] !== 'object') {
                        sanitizedContinuation[key] = continuation[key];
                    }
                }
            }
            return sanitizedContinuation;
        },
        /**
         * Convert an array of values into the format expected by the MediaWiki API.
         * @param {!Array} list A list containing strings and numbers.
         * @return {!String}
         */
        flattenMultivalue(list) {
            return list.join('|');
        },
    },
});
