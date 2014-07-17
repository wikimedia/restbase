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
// create the keyspace and tables as documented in cassandra-revisions.cql
cqlsh < buckets/revisioned-blob/cassandra/tables.cql

// start the server
cd ../../
node restface
```

Usage
-----
```sh
# add a new revision
curl -d "_timestamp=`date -Iseconds`&_rev=1234&wikitext=some wikitext `date -Iseconds`"\
  http://localhost:8888/v1/en.wikipedia.org/pages/Foo/rev/latest/wikitext
# fetch the latest revision
curl http://localhost:8888/v1/en.wikipedia.org/pages/Foo/rev/latest/wikitext
# fetch a specific MediaWiki revision ID:
curl http://localhost:8888/v1/en.wikipedia.org/pages/Foo/rev/1234/wikitext
# fetch the wikitext at or before a given date
curl http://localhost:8888/v1/en.wikipedia.org/pages/Foo/rev/`date -Iseconds`/wikitext
# fetch a specific uuid (adjust to uid returned when you added the revision)
curl http://localhost:8888/v1/en.wikipedia.org/pages/Foo/rev/6c745300-eb62-11e0-9234-0123456789ab/wikitext
```
You can also benchmark the service with
```sh
// 'Hello world' backend
ab -c 10 -n 10000 http://localhost:8888/v1/helloworld
```
This 'hello world' backend should yield around 4k req/s using node 0.10, and
around 7k on node 0.11.

The actual cassandra backend can be benchmarked with:
```
ab -c10 -n10000 'http://localhost:8888/v1/enwiki/pages/foo/rev/latest/wikitext'
```
On a single core this currently yields around 3500req/s with a 95th percentile
latency of 1ms. Using node 0.11 speeds this up to around 5700 req/s.

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

