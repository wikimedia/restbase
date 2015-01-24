"use strict";


function mod_get (restbase, req) {
    return Promise.resolve({
        status: 200,
        body: 'dummy response',
        headers: req.headers
    });
}

function mod_set (restbase, req) {
    return Promise.resolve({
        status: 201
    });
}


module.exports = function (options) {
    // init the module with the provided
    // options, and then:
    return {
        operations: {
            dummyget: mod_get,
            dummyset: mod_set
        }
    };
};

