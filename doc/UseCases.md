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



# Bucket candidates
- queue bucket
    - value: blob
- unordered key-value
    - key: blob, int, tid
    - value: blob, set, map
- ordered [revisioned] key-value
    - key: blob, int, tid
    - value: blob, set, map

