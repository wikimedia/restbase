# RESTBase [![Build Status](https://travis-ci.org/wikimedia/restbase.svg?branch=master)](https://travis-ci.org/wikimedia/restbase) [![Coverage Status](https://coveralls.io/repos/wikimedia/restbase/badge.svg?branch=master)](https://coveralls.io/r/wikimedia/restbase?branch=master)


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

Preparing for basic production. You can try the
**[demo](http://api.wmflabs.org/v1/en.wikipedia.org/pages/Paris/html/626969947)**.

## Issue tracking

We use [Phabricator to track
issues](https://phabricator.wikimedia.org/maniphest/task/create/?projects=PHID-PROJ-mszihytuo3ij3fcxcxgm). See the [list of current issues in RESTBase](https://phabricator.wikimedia.org/tag/restbase/).

## Request flow
![RESTBase request
flow](https://upload.wikimedia.org/wikipedia/commons/a/ab/Restbase_request_flow.svg)

RESTBase is optimized for a very direct and fast read path, with the
expectation that most requests are served straight from storage. The front-end
layer allows very flexible request routing and -orchestration with a
[declarative
configuration](https://github.com/gwicke/restbase/blob/master/doc/Architecture.md#declarative-configuration).
This lets it dispatch requests to a variety of back-end services while
providing a uniform API & a central point for logging & monitoring. The linked
example shows the on-demand generation of HTML from wikitext with a call to
the Parsoid service in case a revision was not found in storage.

## Installation

From the *restbase* project directory, install the Node dependencies:

```sh
npm install
```

[RESTBase-cassandra](https://github.com/gwicke/restbase-cassandra) provides a
table storage service backend for RESTBase. Download & install Cassandra:
http://planetcassandra.org/Download/StartDownload

Start RESTBase:

```sh
node server
```

The defaults without a config file should work for a local Cassandra
installation with the default passwords. To customize RESTBase's behavior,
copy the example config to its default location:

```sh
cp config.example.yaml config.yaml
```

You can also pass in the path to another file with the `-c` commandline option
to `server.js`. If you're running a single Cassandra instance (e.g. a local
development environment), set `storage.default.defaultConsistency` to `one` in
*config.yaml`:

*config.yaml*:

```yaml
# ...

storage:
  default:
    # module name
    # ...
    defaultConsistency: one

# ...
```

## Usage

```sh
# add a new domain (TODO: accept config)
curl -X PUT http://localhost:7231/v1/en.wikipedia.org

# add a new 'pagecontent' bucket to a domain
curl -X PUT -H 'Content-Type: application/json' -d '{ "type": "pagecontent" }' http://localhost:7231/v1/en.wikipedia.org/pages

# add an entry
curl -X PUT -d 'hello world' -H 'content-type: text/html' \
    http://localhost:7231/v1/en.wikipedia.org/pages/Test/html

# Retrieve HTML
curl http://localhost:7231/v1/en.wikipedia.org/pages/{page}/html

# Some listings:
## All keys in bucket
curl http://localhost:7231/v1/en.wikipedia.org/pages/
## Properties for an item
curl http://localhost:7231/v1/en.wikipedia.org/pages/{page}/
## Revisions for a property
curl http://localhost:7231/v1/en.wikipedia.org/pages/{page}/html/
```
The actual cassandra backend can be benchmarked with:
```
ab -c10 -n10000 'http://localhost:7231/v1/en.wikipedia.org/pages/Test/html'
```
On my laptop this currently yields around 2900 req/s on node 0.10 for small
blobs, and around 5GBit for large (3mb) blobs.

## Development

### Testing

To run all the tests from a clean slate, first make sure Cassandra is running locally, then fire up the tests with npm:

```
npm test
```

To run tests from a single file, e.g. *test/parsoid/ondemand.js*, run mocha with the file as an argument:

```
mocha test/parsoid/ondemand.js
```

Note that this might require some setup (e.g. creating the necessary domain and buckets), which is currently done by *test/buckets.js*.

This also works for a directory, e.g. *test/parsoid/*:

```
mocha test/parsoid
```

### Coverage

To check the test coverage, use npm, then browse the report:

```
npm run-script coverage
```

The coverage report can now be found in *&lt;project&gt;/coverage/lcov-report/index.html*.

## Design docs

- [RESTBase](https://github.com/gwicke/restbase/blob/master/doc/)
- [RESTBase-cassandra (storage backend)](https://github.com/gwicke/restbase-cassandra/blob/master/doc/)

