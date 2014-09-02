# MediaWiki page content
- mostly built around revisioned blob buckets per property
- special requirement is support for MediaWiki revisions identified by int ids
- public API implemented in front-end handler

## API
### `GET /v1/en.wikipedia.org/pages/`
List pages.

### `GET /v1/en.wikipedia.org/pages/?ts=20140101T20:23:22.100Z`
List pages, consistent snapshot at a specific time.

### `GET /v1/en.wikipedia.org/pages/{name}`
Redirects to `/v1/en.wikipedia.org/pages/{name}/html`, which returns the
latest HTML.

### `GET /v1/en.wikipedia.org/pages/{name}/`
Lists available properties

### `GET /v1/en.wikipedia.org/pages/{name}/{html|wikitext|data-mw|data-parsoid}`
Returns the *latest* HTML / wikitext / ..

### `GET /v1/en.wikipedia.org/pages/{name}/html/`
Lists timeuuid-based revisions for the HTML property.

### `GET /v1/en.wikipedia.org/pages/{name}/rev/`
Lists MediaWiki revisions for the given page.

### `GET /v1/en.wikipedia.org/pages/{name}/rev/12345`
Get metadata for the given revision (e.g. user, timestamp, edit message).

### `GET /v1/en.wikipedia.org/pages/{name}/html/12345`
Main entry point for Parsoid HTML currently.

Redirects to the corresponding timeuuid-based URL, or directly returns the
HTML (would need purging on re-render / refreshlinks)

### `GET /v1/en.wikipedia.org/pages/{name}/html/12345`
Returns HTML content for the given revision. Could also redirect to the
corresponding timeuuid-based URL.

### `GET /v1/en.wikipedia.org/pages/{name}/html/<timeuuid>`
Returns content for the given timeuuid

### `GET /v1/en.wikipedia.org/pages/{name}/html/20140101T12:11:09.567Z`
Returns content as it looked at the given time.

# Support for MW revision ids
Table:
```javascript
{
    name: 'pages.revisions',
    attributes: {
        // listing: /pages.history/Barack_Obama/
        // @specific time: /pages.history/Barack_Obama/20140312T20:22:33.3Z
        key: 'string',
        branch: 'string', // normally 'master'
        tid: 'timeuuid',
        rev: 'varint',
        latest_tid: 'timeuuid', // static
        tombstone: 'boolean',   // page was deleted
        // revision metadata
        user: 'string',
        wikitext_size: varint,
        info: 'json' // comment, wikitext size etc
    },
    index: {
        hash: 'key',
        range: 'tid',
        order: 'asc', // get first *two* entries to determine tid limit
        static: 'latest_tid'
    },
    secondaryIndexes: {
        // accessible as: /pages.history//rev/12345
        // @specific time: /pages.history//rev/12345/20140312T20:22:33.3Z
        rev: {
            hash: 'rev',
            range: ['tid','key'],
            order: ['desc','asc'], // easy to select the latest entry
            proj: ['tombstone']
        }
    }
}
```
## Issues
### Page renames: 
- rev lookup: will get both old & new name
- linear history: 
    - follow renamed_from column & timestamp
- consistency: CAS on destination followed by CAS on source (but edit on
  source wins)
- Redirects can be cached if we have a way to update the cache.
- Reason for per-page structure: CAS per page
    - Disadvantage: Possibility of non-unique revid assignment

### Non-linear history
- need efficient access to master: denormalize to property in table
- ability for CAS per branch, would like to minimize branches
    - composite partition key
- clean-up of non-merged branches: TTL or maintenance job with notifications
    - use a timeuuid to identify non-master branches, but would need secondary
      range key to find old branches
- renames vs. branches: follow the rename on merge or move branch on rename

#### Non-linear history use cases
Review work-flow
- want to converge on a single version to promote to production
- should encourage single branch, but not force it to avoid blocking the edit
  process

## `GET /{name}/{html|data-mw|data-parsoid|wikitext}/{oldid}`
Get tid range for revid from revision table
- get first *two* entries (>= revid limit 2)
- if revid exists (first matches):
    - if two found: look up highest tid for property less than second entries'
      tid, redirect to that
    - else: redirect to latest URL (without tid) -- should be cache hit

- ELSE: 
    - request various data from Parsoid or MW (wikitext)
    - if that succeeds:
        - save it back to respective backend buckets
        - save the revision info to the rev table
        - return the requested property
    - else: return error

# Saving modified page content

## `POST /{name}`
Regular save API.

**Vars**: 

- `html` & `data-mw`, or `wikitext`.
- oldid the edit is based on

### Short-term implementation
- For HTML: convert to wikitext using Parsoid
- Try to save wikitext through the PHP API, forward cookies
    - on success: 
        - save back new revision with returned oldid
        - kick off request for new revision
    - else: return failure message

### Longer term implementation
- Validate HTML & data-mw using separate service
- HTTP transaction:
    - CAS on revision table -- need this to be structured per-page
        - using tid, doesn't necessarily need to fill in oldid yet (but
          simpler if it does)
    - *then*: save individual properties (idempotent as all versioned)


## Simple save API: `PUT /{name}/{html|wikitext}`
Touching only HTML or wikitext. Flow very similar as above.

## New revision request flow
- edit conflicts *per name/page* can be detected on the page bucket
  ({name}/mw-revision)
    - provide static column for CAS
    - HTTP transaction for dependent updates

### `GET /{revid}/revision`
Returns name & tid for the revision.

# Supporting MediaWiki oldids
Use cases: 
- retrieval by oldid: /v1/en.wikipedia.org/pages/Foo/html/12345
- listing of revisions per page: /v1/en.wikipedia.org/pages/Foo/revisions/`

Other goals:
- separate revision concept from other properties (otherwise end up with a lot
  of duplicated indexes)
- allow efficient lookup of `page -> oldid, tid` and `oldid -> page, tid`
    - primary access implicit in all by-oldid accesses: `oldid -> page, tid`
    - sounds like a table with secondary index

## Caching considerations for by-oldid accesses
Want to minimize round-trips (redirects) while keeping the caching / purging
manageable. Focus on round-trips especially for new content, perhaps more on
cache fragmentation for old content.

- resolve to UUID-based version internally, `return it`
    - if latest revision: needs to be purged
    - if old revision: can be cached, won't change any more (apart from
      security / version upgrades)
    - some cache fragmentation, but can set fairly short TTL as cache miss is
      cheap
- need time range for oldid: timeuuid of *next* oldid
    - so look for 2 oldids >= taget-oldid
        - if only one returned: latest

## Implementation idea
- separate revision bucket: `/v1/en.wikipedia.org/pages.revision/
- check if MW revision exists when referenced: 
    - if not: fetch revision info from API
        - need tid for revision
        - but will need by-timestamp retrieval support in parsoid & PHP
          preprocessor for accurate old revisions
