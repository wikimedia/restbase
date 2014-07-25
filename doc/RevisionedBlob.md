# Revisioned object bucket
## API

### `/{name}`
- `GET`: Redirect to `/{name}/`

### `/{name}/`
- `GET`: List of all properties defined on the object.
- `POST`: Potentially an alternative for form-based creation of new
  properties.

### `/{name}/{prop}`
- `GET`: Latest revision of a page property.
- `PUT`: Save a new revision of an object property. The `tid` for the new
  property revision is returned.
- `POST`: Post a HTTP transaction with potentially several sub-requests to
  atomically create a new object revision. The primary transaction member is
  normally the one posted to.

### `/{name}/{prop}/`
- `GET`: List revisions (by `tid`) of the given property.

### `/{name}/{prop}/{rev}`
- `GET`: Retrieve a property at a given revision. 
- `PUT`: Create a property with the given revision. Requires elevated rights.

### Format
`Revision` can be one of:
- `UUID`: A specific UUID-based revision
- `date` in the past: The revision that was active at a specific time.

`Property` is a string. Examples: `html`, `wikitext`, `data-parsoid`.


## Use case: pages

### `/{name}/mediawiki-revision/`
- `GET`: Lists MediaWiki revisions for this page. Returns a UUID & other
  metadata for each revision.

### `/{name}/mediawiki-revision/{rev}`
- `GET`: Gets the metadata for a specific revision
    - possibly including the tids for sibling revisions

# Alternative: Simple revisioned blobs
## Mapping of front-end requests to backend
### Suffix by property, single bucket
`/Foo%2fBar/html` -> `Foo%2fBar.html`
- simple
### Bucket per property
- allows optimization & access rights per bucket
- but no atomic changes across buckets
    - not even across partitions
    - not even conditional batch!
    - clients can potentially observe different 'latest' versions of different
      properties during write

## Backend API

### `/{name}`
- `GET`: Returns latest version of blob `{name}`
- `PUT`: Save a new revision of a blob. The `tid` for the new property
  revision is returned.
- `POST`: Post a HTTP transaction with potentially several sub-requests to
  atomically create a new blob revision. The primary transaction member is
  normally the one posted to.

### `/{name}/`
- `GET`: List revisions of the blob by `tid`.

### `/{name}/{rev}`
- `GET`: Retrieve a property at a given revision. 
- `PUT`: Create a property with the given revision. Requires elevated rights.

### Format
`Revision` can be one of:
- `UUID`: A specific UUID-based revision
- `date` in the past: The revision that was active at a specific time.

## Pros
- simpler & more universal bucket
- object concept weak in any case, needs to be handled outside of property
  store (revision bucket?)
- public listing of props likely a subset/superset of all available (partly
  private) props
    - partly also a suggestion of on-demand props, so better handled in the
      front-end, based on config (easy to inject new ones from other handlers)
## Cons
- difficult to get listing of all pages
    - would want that ordered anyway, so separate index
        - update with timestamp to make last 
    - can page through all properties: 
      `select w, token(w) from t where token(w) > token('w');`
      http://www.datastax.com/documentation/cql/3.1/cql/cql_using/paging_c.html
- difficult to get listing of all props per page
    - can build index
    - can page through all: 
      `select w, token(w) from t where token(w) > token('w');`

# Retrieval by MW revision ID
Common front-end request by revision ID: `GET /v1/pages/Foo/html/12345`

## Idea
- keep special revid handling out of revisioned object bucket
- separate revisioned bucket with mapping revid -> (name, tid)
- is mutable (renames), although some delay is fine
    - can be cached if we have a way to update the cache

## Front-end handler request flow
- get name & tid for revid from bucket
    - not too expensive, in same request
    - no need to serialize anything
- request actual revision from pages bucket

## New revision request flow
- edit conflicts *per name/page* can be detected on the page bucket
  ({name}/mw-revision)
    - provide static column for CAS
    - HTTP transaction for dependent updates
- mediawiki revision ids can be back-filled
    - missing entry in revid bucket causes wait / polling if requested revid
      looks recent
        - could also trigger assignment of revid, with atomic creation
        - handler fills it in after primary save went through
        - if the handler crashes, other handlers finish the job based on WAL per
          process
            - only idempotent tasks
            - heartbeat table: check for oldest entries
            - if heartbeat older than timeout (1-2 minutes): re-run jobs
    - or we can draw a new one for each attempt using a counter & an atomic
      insert with IF NOT EXISTS ("If-None-Match: *")
        - disadvantage: sparse revids when a lot of save attempts fail

### `GET /{revid}/revision`
Returns name & tid for the revision.
