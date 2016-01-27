'use strict';

var stream = require('stream');

function hello(restbase, req) {
    var body = new stream.PassThrough();
    body.end('hello');
    return {
        status: 200,
        headers: {
            'content-type': 'text/html',
        },
        body: body
    };
}

function buffer(restbase, req) {
    var body = new stream.PassThrough();
    body.write(new Buffer('hel'));
    // Delay the final write to test async production.
    setTimeout(function() {
        body.end(new Buffer('lo'));
    }, 500);

    return {
        status: 200,
        headers: {
            'content-type': 'text/html',
        },
        body: body
    };
}

function chunks(restbase, req) {
    var body = new stream.PassThrough();
    for (var i = 0; i < 100; i++) {
        body.write(i.toString());
    }
    body.end();
    return {
        status: 200,
        headers: {
            'content-type': 'text/html',
        },
        body: body
    };
}

module.exports = function(options) {
    return {
        spec: {
            paths: {
                '/hello': {
                    get: {
                        operationId: 'hello'
                    }
                },
                '/buffer': {
                    get: {
                        operationId: 'buffer'
                    }
                },
                '/chunks': {
                    get: {
                        operationId: 'chunks'
                    }
                }
            }
        },
        operations: {
            hello: hello,
            buffer: buffer,
            chunks: chunks,
        }
    };
};
