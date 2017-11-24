## 0.18.0 (2017-11-27)

**Breaking changes**

- `RESTBase` now depends on Cassandra 3.11. In case SQLite backen is used no changes us required.
- After updating `RESTBase` new keyspaces will be created for everything, so it's effectively starting the storage from scratch. All the content stored in `RESTBase` can be rerendered, so no need to transfer the data, but old keyspaces can be deleted afterwards. New keyspace names have `_ng` suffix. 

 
**New features**

- New backend implementation for Parsoid storage. Only the latest render of the latest revision is stored forever, previous renders are only stored for `grace_ttl` period (24h by default) 
