RESTFace
========

[REST content
API](https://www.mediawiki.org/wiki/Requests_for_comment/Content_API) service prototype.

Provides a consistent & performance-oriented REST API. Internally it uses a
very modular structure, with front-end handlers communicating with back-ends
using HTTP-like requests against a virtual REST interface. Back-end handlers
in turn implement a simple HTTP request interface, and can be easily moved to
their own network service.

## Installation
```sh
npm install
```

[Rashomon](https://github.com/gwicke/rashomon) provides a storage service backend for RestFace. It currently implements a Cassandra backend.


- Download cassandra from
  <http://planetcassandra.org/Download/StartDownload>
- Clone the rashomon backend handler & npm install it
```sh
cd handlers/backend
git clone https://github.com/gwicke/rashomon.git
cd rashomon
npm install

// start the server
cd ../../
node restface
```

Usage
-----
```sh
# add a new domain (TODO: accept config)
curl -X PUT http://localhost:8888/v1/en.wikipedia.org

# add a new bucket to a domain (somewhat magic currently)
curl -X PUT http://localhost:8888/v1/en.wikipedia.org/pages.html

# add an entry
curl -X PUT -d 'hello world' -H 'content-type: text/html' \
    http://localhost:8888/v1/en.wikipedia.org/pages/Test/html

# Retrieve HTML
curl http://localhost:8888/v1/en.wikipedia.org/pages/{page}/html

# Some listings:
## All keys in bucket
curl http://localhost:8888/v1/en.wikipedia.org/pages/
## Properties for an item
curl http://localhost:8888/v1/en.wikipedia.org/pages/{page}/
## Revisions for a property
curl http://localhost:8888/v1/en.wikipedia.org/pages/{page}/html/
```
The actual cassandra backend can be benchmarked with:
```
ab -c10 -n10000 'http://localhost:8888/v1/en.wikipedia.org/pages/Test/html'
```
This currently yields around 2900 req/s on node 0.10 for small blobs, and
around 5GBit for large (3mb) blobs.

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

