'use strict';

/**
 * Unit tests for util methods
 */

const P = require('bluebird');
const mwUtil = require('../../lib/mwUtil');
const assert = require('../utils/assert');

describe('Utils.hydrateResponse', () => {
    it('Should support $merge', () => {
        const response = {
            body: {
                non_existent: {
                    $merge: ['you_shall_not_pass']
                },
                array: [
                    {
                        $merge: ['you_shall_not_pass']
                    },
                    {
                        $merge: ['you_shall_not_pass']
                    },
                    {
                        prop: 'this_will_be_overwritten',
                        $merge: ['prop_contained_here']
                    }
                ],
                object: {
                    some_other_prop: 'hello',
                    $merge: ['prop_contained_here']
                }
            }
        };

        return mwUtil.hydrateResponse(response, (uri) => {
            switch (uri) {
                case 'you_shall_not_pass':
                    return P.resolve(undefined);
                case 'prop_contained_here':
                    return P.resolve({
                        prop: 'prop_value'
                    });
                default:
                    return P.reject(new Error('What?'));
            }
        })
        .then((response) => {
            assert.deepEqual(response, {
                body: {
                    array: [{
                        prop: 'prop_value'
                    }],
                    object: {
                        some_other_prop: 'hello',
                        prop: 'prop_value'
                    }
                }
            });
        });
    });
});
