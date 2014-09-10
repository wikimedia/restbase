# RESTBase

[REST content
API](https://www.mediawiki.org/wiki/Requests_for_comment/Content_API) and [storage service](https://www.mediawiki.org/wiki/Requests_for_comment/Storage_servicehttps://www.mediawiki.org/wiki/Requests_for_comment/Storage_service) prototype.

Provides a consistent & performance-oriented REST content API. Internally it
uses a very modular structure, with front-end handlers communicating with
back-ends using HTTP-like requests against a virtual REST interface.

The storage backends implement a distributed table storage service similar to
[Amazon DynamoDB](http://aws.amazon.com/documentation/dynamodb/) and [Google
DataStore](https://developers.google.com/datastore/), currently using Apache
Cassandra as a backend. Notable features include automatically maintained
secondary indexes (in development) and transactions (only CAS + dependent
updates for now). See [the
tests](https://github.com/gwicke/rashomon/blob/8a55b377173b08a6c772a208e69d2edf9425ad3a/storage/cassandra/test.js#L86)
for example schema definitions and queries.

Table storage is in turn used to build higher-level storage buckets for common
tasks. The first supported bucket types are a revisioned key-value bucket, and
an even higher-level MediaWiki page content bucket.

## Request flow
RESTBase is optimized for a very direct and fast read path, with the
expectation that most requests are served straight from storage. The front-end
layer allows very flexible request routing and -orchestration with a
[declarative
configuration](https://github.com/gwicke/restbase/blob/master/doc/Architecture.md#declarative-configuration). This lets it dispatch requests to a variety of back-end services while providing a uniform API & a central point for logging & monitoring. The linked example shows the on-demand generation of HTML from wikitext with a call to the Parsoid service in case a revision was not found in storage.

## Installation
```sh
npm install
```

[Rashomon](https://github.com/gwicke/rashomon) provides a storage service backend for RESTBase. It currently implements a Cassandra backend.


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
node restbase
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
On my laptop this currently yields around 2900 req/s on node 0.10 for small
blobs, and around 5GBit for large (3mb) blobs.

Design docs
===========

- [RESTBase](https://github.com/gwicke/restbase/blob/master/doc/)
- [Rashomon (storage backend)](https://github.com/gwicke/rashomon/blob/master/doc/)

