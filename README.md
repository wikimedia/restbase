# RESTBase [![Build Status](https://travis-ci.org/wikimedia/restbase.svg?branch=master)](https://travis-ci.org/wikimedia/restbase) [![Coverage Status](https://coveralls.io/repos/wikimedia/restbase/badge.svg?branch=master)](https://coveralls.io/r/wikimedia/restbase?branch=master)


RESTBase was built to provide a [low-latency & high-throughput API for
Wikipedia / Wikimedia
content](http://rest.wikimedia.org/en.wikipedia.org/v1/?doc). It is basically
a storage proxy, which presents a coherent API powered by Swagger specs to the
outside, and backs up many of these entry points with storage.  The default
**table storage** backend is based on Cassandra, which helps it to perform
well at Wikimedia's scale without placing undue burden on operations.

As a proxy, RESTBase does not perform any significant content processing
itself. Instead, it requests content transformations from backend services
when needed, and typically (depending on configuration) stores it back for
later retrieval. For high-volume static end points, most requests will be
satisfied directly from storage.

The *table storage* backends conform to a RESTful [table storage
API](https://github.com/wikimedia/restbase/blob/master/doc/TableStorageAPI.md)
similar to [Amazon DynamoDB](http://aws.amazon.com/documentation/dynamodb/)
and [Google DataStore](https://developers.google.com/datastore/). The primary
implementation uses Apache Cassandra. Notable features include automatically
maintained secondary indexes and some lightweight transaction support. A
[SQLite backend](https://github.com/wikimedia/restbase-mod-table-sqlite) is
under development.

RESTBase systematically emits statsd metrics about storage and backend
requests. Specifically, the systematic metric production for backend services
provides a good baseline level of instrumentation for tracking performance
and errors in a micro-service architecture.

## Issue tracking

We use [Phabricator to track
issues](https://phabricator.wikimedia.org/maniphest/task/create/?projects=PHID-PROJ-mszihytuo3ij3fcxcxgm). See the [list of current issues in RESTBase](https://phabricator.wikimedia.org/tag/restbase/).

## Installation

Make sure that you have node 0.10+:
```sh
sudo apt-get install nodejs nodejs-legacy nodejs-dev npm
```

From the *restbase* project directory, install the Node dependencies:

```sh
npm install
```

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
development environment), set `defaultConsistency` to `one` in
`config.yaml`.

## Usage

See the [Wikimedia REST content API
sandbox](https://rest.wikimedia.org/en.wikipedia.org/v1/?doc) for a fine
example of what RESTBase can do.

## Development

### Testing

To run all the tests from a clean slate, first make sure Cassandra is running locally, then fire up the tests with npm:

```
npm test
```

To run tests from a single file, e.g. *test/features/pagecontent/rerendering.js*, run mocha with the file as an argument:

```
mocha test/features/pagecontent/rerendering.js
```

Note that this might require some setup (e.g. creating the necessary domain and buckets), which is currently done by *test/buckets.js*.

This also works for a directory, e.g. *test/features/pagecontent/*:

```
mocha test/features/pagecontent
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

