# MediaWiki page content
- mostly built around revisioned blob buckets per property
- special requirement is support for MediaWiki revisions identified by int ids
- a coherent content API integrating the more general back-end buckets and
  back-end services like the MediaWiki core API or Parsoid is implemented in a
  front-end handler

## API
### `GET /en.wikipedia.org/v1/page/`
List pages.

- `/en.wikipedia.org/sys/page_revision/`

### `GET /v1/en.wikipedia.org/page/?ts=20140101T20:23:22.100Z`
List pages, consistent snapshot at a specific time. No need to return oldids
or tids, same timestamp can be used to retrieve each individual page. It
should however be more efficient to directly return the matching tids.

- `/en.wikipedia.org/sys/page_revisions/?ts=20140101T20:23:22.100Z`

### `GET /en.wikipedia.org/v1/page/{title}`
Redirects to `/en.wikipedia.org/v1/page/{name}/html`, which returns the
latest HTML.

- in handler

### `GET /v1/en.wikipedia.org/page/{title}/`
Lists available properties. 

- Static listing through swagger-router. Have `_ls` parameter, need to convert
    this into a full response.

### `GET /en.wikipedia.org/v1/page/{title}/{format:/html|wikitext|data-mw|data-parsoid/}`
Returns the *latest* HTML / wikitext etc. Cached & purged.

### `GET /en.wikipedia.org/v1/page/{title}/html/`
Lists timeuuid-based revisions for the HTML property.

### `GET /en.wikipedia.org/v1/page/{title}/rev/`
Returns a list of MediaWiki revisions for the given page. Contains the
information needed to display the page history.

- `/en.wikipedia.org/sys/page_revisions/{title}/`

### `GET /en.wikipedia.org/v1/page/{title}/rev/12345`
Get metadata for the given revision (e.g. user, timestamp, edit message).

- `/en.wikipedia.org/sys/page_revisions/{title}/{revision}`

### `GET /en.wikipedia.org/v1/page/{name}/html/12345`
Retrieve a property by MediaWiki oldid. Main entry point for Parsoid HTML.

- `/en.wikipedia.org/sys/parsoid/html/{title}/{revision}`

### `GET /en.wikipedia.org/v1/page/{name}/html/<timeuuid>`
Returns content for the given timeuuid. Only stored (no on-demand creation),
404 if not in storage.

- `/en.wikipedia.org/sys/parsoid/html/{title}/{revision}`

### `GET /v1/en.wikipedia.org/pages/{name}/html?ts=20140101T12:11:09.567Z`
Returns content as it looked at the given time.

- `uri: /en.wikipedia.org/sys/parsoid/html/{title} + query`

# Support for MW revision ids
See [the revision table](https://github.com/wikimedia/restbase/blob/0ce4e64d455ab642a17483d594a49717f6418d21/lib/filters/bucket/pagecontent.js#L31).

Implementation note: Don't need support for range queries on secondary indexes
for this index.

## Issues
### Page renames: 
- linear history: 
    - follow renamed_from column & timestamp
- consistency: CAS on destination followed by CAS on source (but edit on
  source wins)
    - or multi-item transaction (concurrent write fails, retry follows rename)
- Redirects can be cached if we have a way to update the cache.
- Reason for per-page structure: CAS per page
    - Disadvantage: Possibility of non-unique revid assignment; could use
      multi-item transaction to avoid this on page creation (if we care)
    - Alternatively some reservation scheme for global revids with timeout

### Non-linear history
- decided to keep this out of the pagecontent bucket for now
    - can create another draft bucket for now
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

## Page metadata API
- red links
    - [example query](http://en.wikipedia.org/w/api.php?action=query&prop=info&format=json&titles=Foo&generator=links&gpllimit=500)
    - look for 'missing' in the result
    - should save this, but will need cache invalidation on article creation /
      deletion using pagelinks (currently only templatelinks)
- self links https://bugzilla.wikimedia.org/show_bug.cgi?id=67486
    - should be straightforward with CSS
- bad image list

### Needs pref info
- section edit links
- toc
- stub thresholds (for some users, separately, pref)

### Possibly later
- page images not to render in MediaViewer (similar to image block list)
