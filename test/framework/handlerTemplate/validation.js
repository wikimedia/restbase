'use strict';

var handlerTemplate = require('../../../lib/handlerTemplate');
var assert = require('./../utils/assert.js');

// mocha defines to avoid JSHint breakage
/* global describe, it, before, beforeEach, after, afterEach */

describe('Handler Template Spec Validation', function() {
    function testValidation(action, expectedError) {
        var caught;
        try {
            action();
        } catch (e) {
            caught = true;
            assert.deepEqual(expectedError.test(e.message), true);
        }
        if (!caught) {
            throw new Error('Error should be thrown');
        }
    }

    it('Checks parallel returning requests', function() {
        testValidation(function() {
            handlerTemplate.createHandler([{
                get_one: {
                    request: {
                        uri: 'http://en.wikipedia.org/wiki/One'
                    },
                    return: '{$.get_one}'
                },
                get_two: {
                    request: {
                        uri: 'http://en.wikipedia.org/wiki/Two'
                    },
                    return: '{$.get_two}'
                }
            }]);
        }, /^Invalid spec\. Returning requests cannot be parallel\..*/);
    });

    it('Requires either return or request', function() {
        testValidation(function() {
            handlerTemplate.createHandler([{
                get_one: {}
            }]);
        }, /^Invalid spec\. Either request or return must be specified\..*/);
    });

    it('Compiles a valid condition function', function() {
        handlerTemplate.createHandler([{
            get_one: {
                request: {
                    uri: '/my/path'
                },
                return_if: {
                    status: '5xx'
                },
                return: '{$.request}'
            }
        }]);
    });

    it('Requires request for return_if', function() {
        testValidation(function() {
            handlerTemplate.createHandler([{
                get_one: {
                    return_if: {
                        status: '5xx'
                    },
                    return: '$.request'
                }
            }]);
        }, /^Invalid spec\. return_if should have a matching request\..*/);
    });

    it('Requires request for catch', function() {
        testValidation(function() {
            handlerTemplate.createHandler([{
                get_one: {
                    catch: {
                        status: '5xx'
                    },
                    return: '$.request'
                }
            }]);
        }, /^Invalid spec\. catch should have a matching request\..*/);
    });

    it('Requires correct catch definition', function() {
        testValidation(function() {
            handlerTemplate.createHandler([{
                get_one: {
                    request: {
                        uri: 'test_path'
                    },
                    catch: {
                        status: 'asdf'
                    },
                    return: '$.request'
                }
            }]);
        }, /^Invalid catch condition asdf.*/);
    });

    it('Requires spec to be an array', function() {
        testValidation(function() {
            handlerTemplate.createHandler({
                this_is_illegal: 'very illegal'
            });
        }, /^Invalid spec. It must be an array of request block definitions\..*/);
    });

    it('Requires a return if the last step is parallel', function() {
        testValidation(function() {
            handlerTemplate.createHandler([{
                get_one: {
                    request: {
                        uri: 'http://en.wikipedia.org/wiki/One'
                    }
                },
                get_two: {
                    request: {
                        uri: 'http://en.wikipedia.org/wiki/Two'
                    }
                }
            }]);
        }, /^Invalid spec. Need a return if the last step is parallel\./)
    });
});