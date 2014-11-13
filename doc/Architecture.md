# Goals and constraints
RESTBase aims to provide 

1. flexible and scalable storage, and 
2. a consistent and extensible REST API for internal and external access to
   (typically stored) content and data.

## The case for hooks in the read & write paths
In the write path, we often need to ensure that a specific (configurable) set
of validation and sanitization steps are applied *before* storing a bit of
information. Such steps are often security-critical, so there should be no way
to bypass them. This means that we can't trust each client to do the right
checks before storing something. It is possible to use cryptographic signatures
to check that certain steps have in fact been applied to a bit of content, but
at that point it seems to be simpler to just handle the application of these
steps centrally and without a duplication of code. Similar unconditional hooks
are needed *after* a save went through (for dependent updates / async jobs).

In the read path, we need to determine whether the user is authorized to read
the resource. This might involve calls into the auth service, for example in
the case of deleted revisions. Even if the user has access, there is a need to
double-check & possibly re-sanitize old, stored content.  

Additionally, we'd often like to handle *missing information* by *creating it
on demand*. Examples would be parsing of wikitext to HTML, the generation of a
specific HTML flavor (for mobile, say), the extraction of metadata from a
revision, or the rendering of a mathematical formula.

The pure orchestration of backend services through network requests can be
done efficiently and with very little code. The physical separation between
storage and back-end services avoids security and performance issues, and
enforces the use of well-defined interfaces. The overall functionality
provided is somewhat similar to MediaWiki's hooks, adapted to a distributed
environment.

## Extensible storage using tables and buckets with associated behavior
For a flexible storage service, we need

- storage primitives suitable for a variety of use cases, and 
- the ability to dynamically configure and use these primitives.

For the use cases we have in mind, the following storage primitives are very
attractive:

- Tables: A set of typed attributes with a primary index and optional
  secondary indexes, defined by a JSON schema.
- Buckets: Higher-level combinations of storage and behavior. Examples:
  S3-like (revisioned) blob storage, Revisioned MediaWiki page content in
  different formats (html, wikitext, JSON metadata, ..) with lookup by title,
  time or revision. Buckets can, but don't need to be, implemented on top of
  tables.

The desired behavior of hooks as discussed in the preceding paragraph depends
on the specific entry point. For example, a request for the HTML of a revision
within a page content bucket should trigger sanitization and on-demand
creation behavior that's different from that for wikitext of the same
revision. A lot of this behavior can be hard-coded in a bucket implementation
(or triggered by something like the content type), but some of it should also
be configurable per type or instance. 

As an example, it should be easy to 

- create a new bucket for something like a bit of metadata extracted from a
  page revision,
- register a service end point to call if this data doesn't exist yet for a
  revision, and
- register another service end point to call after each edit, to pre-generate
  the metadata as soon as possible.


## Most API end points will (eventually) be storage-backed
The focus of the content / data API is high-performance access to content and
data. This means that [most entry points](UseCases.md) will be backed by storage or large,
persistent caches. The primary exceptions to this are:

- search & action=query-like functionality
- imperatitive actions:
    - emailuser
    - purge
    - auth related end points, user blocking (eventually: auth service)
- many data access end points in the PHP API

With a REST-style API it is relatively straightforward to route these entry
points directly to their internal service end points in Varnish.

# Data Flow & code structure
Originally, RESTBase started out as two separate services: 

- Rashomon, a storage service
- RESTFace, an API service on top of Rashomon

However, we soon realized that there would be basically no good use case for
direct requests to Rashomon ([see old
notes](https://github.com/wikimedia/restbase/blob/07e7b6a5cdcfc14807f8e7d033eefbc47150cf13/doc/Architecture.md#data-flow)).
Separating the two services would just add a network hop in the common storage
access path. 

The desire to swap out storage backends made the table storage layer a very
good frontend / backend interface. Higher-level functionality like buckets is
implemented in RESTBase on top of table storage, and thus works across
different table storage backends. None of the operations it exposes is in any
way tied to Cassandra, and additional storage backends are planned in the
future.


Here is a (very rough) sketch of the current structure:

```
API Clients         Internet
 |
 V
 .----------------. RESTBase
 V                | 
Proxy Handlers    |            Proxy / API Layer (restbase)
 |-> global     ->|
 |-> per-domain ->| <---> Backend services
 |-> bucket     ->' <---> MediaWiki
 | 
 | if no match or loop 
 |
 |-> table storage           Storage Layer (restbase-cassandra, ..)
 '-> queue backend
```

# Detailed description of components

## RESTBase
- Simple request routing and response massaging ('hook' functionality)
- Dispatch layer for backend services

### Proxy layer configuration: [HandlerConfiguration.md](Declarative proxy handlers)
- declarative / language-independent request flow specs
- currently working out the details
- will likely be supported globally, per-domain & per-type (bucket / table)
- can be layered (use wisely); can trace path of request through restbase &
  log / monitor sub-requests generically

### Buckets
- higher-level, reusable storage abstractions on top of table storage
- can be composed e.g. with multiple revisioned blob sub-buckets in a
  pagecontent bucket

## Storage layer
- currently only table storage backend interface
    - first implementation: restbase-cassandra; others to follow
- can use multiple backends at once
- can add other backend *types* later (ex: queue, large blob storage)

# Bucket access restrictions
Goals: 
- Allow fairly direct *read* access (bulk of requests)
- Unconditionally enforce group access at lowest (table access) level
- Enforce additional service processing constraints (sanitization etc) by
    - calling those services unconditionally
    - (ideally) verifying the authenticity of those services with signatures
      or TLS certs

- grant bucket operation (read, edit) to [user group, (service x entry point)]
    - user groups
    - some kind of request auth based on
        - private service key
        - bucket path
        - front-end handler name
        
    - should all be doable just above the table storage layer
    - perhaps something like 
      hash(nonce or (ssl?) session key | private_restbase_key | bucket_path | handler_name)

- revision / page deletions:
    - read access only for some users
    - currently modeled as a property on the revision (as in MediaWiki), but
      might be worth looking into time ranges instead

See [the SOA authentication RFC for details](https://www.mediawiki.org/wiki/Talk:Requests_for_comment/SOA_Authentication).

