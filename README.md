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

Handler interface
=================

### Leverage ES6 generators + promises for readable code

Requires Node 0.11+, which is scheduled to be released Real Soon Now™.

[Single file per handler in a directory](https://github.com/gwicke/restface/blob/master/handlers); require is wrapped in try/catch for robustness.
