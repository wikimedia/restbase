'use strict';

/**
 * Unit tests for util methods
 */

const P = require('bluebird');
const mwUtil = require('../../lib/mwUtil');
const assert = require('../utils/assert');

describe('Utils.populate', () => {
    it('Should support $merge', () => {
        const responce = {
            body: {
                non_existent: {
                    $merge: ['you_shall_not_pass']
                },
                array: [
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

        return mwUtil.populate(responce, (uri) => {
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
        }, '$merge')
        .then((responce) => {
            assert.deepEqual(responce, {
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
