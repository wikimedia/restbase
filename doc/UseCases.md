# Use cases for buckets

see maintenance/tables.sql

## Page storage
### RevisonedBlob per page property
- name + property: `Foo.html`
- CAS on `revision` property, HTTP transaction
    - also used for listing of MW revisions per page

### RevisionedBlob for oldid -> (name, tid) mapping ('revisions')
- updated as dependent of CAS, possibly using pre-generated oldid

## Link tables
Need to look into access patterns

### page -> links
- key-value bucket (not revisioned) with JSON blob for values
- alternatively, a set bucket type for more efficient updates

## Recent changes
Ordered key-value bucket
    - ordered -> single partition (or at least a skip list on single
      partition)
    - if data is not very sparse, can bucket by date or the like to limit size
      per partition

## User contributions
Ordered key-value bucket

## Watch list
user -> namespace / title

# Low-level bucket candidates
- queue bucket
    - value: blob
- unordered key-value
    - key: blob, int, tid
    - value: blob, set, map
- ordered [revisioned] key-value
    - key: blob, int, tid
    - value: blob, set, map

## High-level bucket candidates
- pages: everything needed to back a wiki's textual content, but not media
    - revisioned page store
    - link tables
    - recentchanges?
    - search? might want to index this globally with domain attribute, then
      query with domain for per-wiki search

Potentially global:
- media
- users
    - timeline / notifications
    - contributions
    - blocking
    - watchlist with inverted index url -> watchers
- subscriptions
    - url pattern, event -> list of urls
    - url, event -> list of urls
- jobs
    - rest job queues with execution in restbase
- recent changes
- search
- persistent caches
    - i18n
    - RL
- analytics
    - logging
    - counters

# Use cases for pure services without storage in restbase
- search / action=query type stuff
- citation service; actually likely to use storage later (cache)
- PHP API:
    - feeds: recent changes, contributions
    - purge
    - emailuser
    - globalblock
    - abusefilter\*
    - pagetriage\*
    - titleblacklist
