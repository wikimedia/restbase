RESTFace
========

REST API interface proxy prototype

Provides a consistent external REST API

Goals
=====
- easy to register end point handlers without interfering with other handlers
- generic monitoring of all backend requests
	- backend perf / issue monitoring
	- know which handler initiated which requests
- robust even if there are faulty handlers
	- don't crash if there's a syntactical error in a handler
	- blacklist handlers that crashed or timed out often recently (fuse)
	- limit the time a single request can take, properly respond to client
- optimize for proxying use case
	- make it easy to forward request to backend with minor changes
	- typical handler action is handling 404s, retrying, combining content etc
	- handlers are not expected to perform CPU-intense computations
		- move those to separate services on separate machine / process

Middleware interface
====================

### Leverage ES6 generators + promises for readable code

Requires Node 0.11+, which is scheduled to be released Real Soon Now™.

Single file per handler in a directory; require is wrapped in try/catch for robustness.
```javascript
// Run with 'node --harmony' using node 0.11+

/*
 * env.{GET,PUT,..} provides a virtual REST service by mapping paths to
 * backend requests. Returns promises.
 */
function* handleRequest (env, req) {
    // Rewrite the URI to the backend
    req.uri = '/v1/' + env.account + '/pages' + req.uri;
    // Try the backend first
    var beResp = yield env.GET(req);
    if (beResp.status === 200) {
        // all done
        return beResp;
    } else if (beResp.status === 404) {
        // Try to generate the request with Parsoid
        var parsoidResp = yield env.GET('/v1/_parsoid/' + env.account + env.req.uri);
        if (parsoidResp.status === 200) {
            // Asynchronously save back the HTML, don't wait for it to finish
			env.PUT({
				uri: req.uri,
				headers: parsoidResp.headers,
				body: parsoidResp.body
			});
        }
        return parsoidResp;
    }
}

// Register handler for end point
module.exports = {
	path: '/v1/:account/pages/:title/rev/:rev/html',
	handler: handleRequest
};
```

### Alternative version with ES6 promises, but without generators

- Disadvantage: slightly uglier & more verbose than generators.
- Advantage: Compatible with node 0.10 using for example es6-shim. Native
  promise implementation is in Node 0.11+.

```javascript
// Simple request handler
function handleRequest( env ) {
    // Rewrite the URI to the backend
    env.req.uri = '/v1/' + env.account + '/pages' + env.req.uri;
    return env.GET(env.req)
	.then(function(resp) {
		if (resp.status === 404) {
            // try to generate HTML on the fly by calling Parsoid
            var parsoidRequest = { uri: '/v1/_parsoid/' + env.account + env.req.uri };
            env.GET(parsoidRequest)
			.then(function(resp) {
				// handle the response from Parsoid
				if (resp.status === 200) {
					// Asynchronously save back the HTML
					env.PUT({
						uri: '/v1/' + account + '/pages' + env.req.uri,
						headers: resp.headers,
						body: resp.body
					});,
				}
				// And return the response to the client
				return resp;
			}
		} else {
			return resp;
		}
	}
}

// Register handler for end point
module.exports = {
	path: '/v1/:account/pages/:title/rev/:rev/html',
	handler: handleRequest
};
```
