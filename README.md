RESTFace
========

REST API interface service prototype.

Provides a consistent & performance-oriented REST API for 

Usage
-----
We are leveraging ES6 generators & promises, which means that node 0.11+ is
required.

```sh
node --harmony restface
```

You can now benchmark the service with
```sh
ab -c10 -n10000 'http://localhost:8888/v1/enwiki/pages/foo/rev/latest/html'
```
On a single core & with a simple static 'hello world' backend, this currently
yields around 7500 req/s. The routing & generator-based handler overhead is
very low.

Implementation goals
====================
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

Handler interface
=================
- [Single file per handler in a directory](https://github.com/gwicke/restface/blob/master/handlers/)
- require is wrapped in try/catch for robustness
- integrates routing and documentation

Architecture docs
=================

See [here](https://github.com/gwicke/restface/blob/master/doc/Architecture.md).

