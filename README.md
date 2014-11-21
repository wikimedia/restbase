# RESTBase 

[REST content
API](https://www.mediawiki.org/wiki/Requests_for_comment/Content_API) and [storage service](https://www.mediawiki.org/wiki/Requests_for_comment/Storage_service) prototype.

Provides a consistent & performance-oriented REST content API. Internally it
uses a very modular structure, with proxy handlers communicating with
storage back-ends using HTTP-like requests against a virtual REST interface.

The main backend types provide *table storage* and *queues*. The table storage
backends implement a distributed table storage service similar to [Amazon
DynamoDB](http://aws.amazon.com/documentation/dynamodb/) and [Google
DataStore](https://developers.google.com/datastore/). The first implementation
uses Apache Cassandra. Notable features include automatically maintained
secondary indexes (in development) and transactions (only CAS + dependent
updates for now). See [the
tests](https://github.com/gwicke/restbase-cassandra/blob/8a55b377173b08a6c772a208e69d2edf9425ad3a/storage/cassandra/test.js#L86)
for example schema definitions and queries.

Table storage is in turn used to build higher-level storage buckets for common
tasks. The first supported bucket types are a revisioned key-value bucket, and
an even higher-level MediaWiki page content bucket.

A queue implementation using Kafka is planned. See [these design notes](https://github.com/gwicke/restbase-cassandra/blob/master/doc/QueueBucket.md) for details.

## Status
[![Build Status](https://travis-ci.org/gwicke/restbase.svg?branch=master)](https://travis-ci.org/gwicke/restbase)

Prototype, preparing for basic production. You can try the
**[demo](http://api.wmflabs.org/v1/en.wikipedia.org/pages/Paris/html/626969947)**.

## Request flow
```
API Clients         Internet
 |
 V
 .----------------. RESTBase
 V                | 
Proxy Handlers    |            Proxy Layer
 |-> per-domain ->|
 |-> global     ->| <---> Backend services
 |-> bucket     ->' <---> MediaWiki
 | 
 | if no match or loop 
 |
 |-> table storage           Storage Layer
 '-> queue backend
```

RESTBase is optimized for a very direct and fast read path, with the
expectation that most requests are served straight from storage. The front-end
layer allows very flexible request routing and -orchestration with a
[declarative
configuration](https://github.com/gwicke/restbase/blob/master/doc/Architecture.md#declarative-configuration). This lets it dispatch requests to a variety of back-end services while providing a uniform API & a central point for logging & monitoring. The linked example shows the on-demand generation of HTML from wikitext with a call to the Parsoid service in case a revision was not found in storage.

## Installation
```sh
npm install
```

[RESTBase-cassandra](https://github.com/gwicke/restbase-cassandra) provides a table storage service backend for RESTBase. Download & install Cassandra: http://planetcassandra.org/Download/StartDownload

- Start RESTBase
```sh
node server
```

Usage
-----
```sh
# add a new domain (TODO: accept config)
curl -X PUT http://localhost:8888/v1/en.wikipedia.org

# add a new bucket to a domain (somewhat magic currently)
curl -X PUT -H 'Content-Type: application/json' -d '{ "type": "pagecontent" }' http://localhost:8888/v1/en.wikipedia.org/pages.html

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
- [RESTBase-cassandra (storage backend)](https://github.com/gwicke/restbase-cassandra/blob/master/doc/)

