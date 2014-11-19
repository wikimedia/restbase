# JSON table schema

Example:
```javascript
{
    table: 'example',
    // Attributes are typed key-value pairs
    attributes: {
        name: 'string',
        property: 'string',
        tid: 'timeuuid',
        length: 'int',
        value: 'string'
    },
    // Primary index structure: The order of index components matters. Simple
    // single-level range queries are supported below the hash key level.
    index: [
        { type: 'hash', attribute: 'name' },
        { type: 'range', order: 'asc', attribute: 'property' },
        { type: 'range', order: 'desc', attribute: 'tid' }
    },
    // Optional secondary indexes on the attributes
    secondaryIndexes: {
        by_tid: {
            { type: 'hash', attribute: 'tid' },
            // Primary key attributes are included implicitly
            // Project some additional attributes into the secondary index
            { type: 'proj', attribute: 'length' }
        }
    }
}
```

## Supported types
- `blob`: arbitrary-sized blob; in practice, should be single-digit MB at most
  (at least for Cassandra backend)
- `set<T>`: A set of type T.
- `int`: A 32-bit signed integer.
- `varint`: A variable-length (arbitrary range) integer. Backends support at
  least a 64 bit signed integer. Note that there might be further limitations
  in client platforms; for example, Javascript can only represent 52bits at
  full integer precision in its Number type. Since our server-side
  implementation decodes JSON to doubles, this is also the maximum range the
  we currently support in practice. We might add support for an alternative
  JSON string representation of larger integers in the future.
- `decimal`: Decimal number.
- `float`: Single-precision (32-bit) floating point number.
- `double`: Double-precision (64-bit) floating point number.
- `boolean`: A boolean.
- `string`: An UTF8 string.
- `timeuuid`: A [version 1 UUID](https://en.wikipedia.org/wiki/Universally_unique_identifier#Version_1_.28MAC_address_.26_date-time.29) as a string. Sorted by timestamp.
- `uuid`: A [version 4 UUID](https://en.wikipedia.org/wiki/Universally_unique_identifier#Version_4_.28random.29) as a string.
- `timestamp`: [ISO 8601 timestamp](https://en.wikipedia.org/wiki/ISO_8601) as
  a string.
- `json`: A JSON sub-object (as an embedded object, not a string), which is transparently parsed back to JSON.

## Secondary index consistency
Queries on secondary indexes are eventually consistent by default. While new
entries are inserted along with the data, it is possible that *false
positives* are returned for a short time after the primary request was
acknowledged. We will also support optional strongly consistent secondary
index requests at the cost of cross-checking the index match with the actual
data, at least on some backends.

# Queries
Select the first 50 entries:

```javascript
{
    table: 'example',
    limit: 50
}
```

Limit the query to 'Tom':
```javascript
{
    table: 'example',
    attributes: {
        name: 'Tom'
    },
    limit: 50
}
```

Limit the query to 'Tom', and select properties that are greater than 'a', and
smaller or equal to 'c'. Also, only select the 'value' column:
```javascript
{
    table: 'example',
    attributes: {
        name: 'Tom',
        property: {
            gt: 'a',
            le: 'c'
        }
    },
    // Only select the 'value' column
    proj: ['value']
    limit: 50
}
```

Now, descend down the primary index tree one level further & perform a
range query on the `tid` key:
```javascript
{
    table: 'example',
    attributes: {
        name: 'Tom',
        property: 'foo', // Note: needs to be fixed
        tid: {
            le: '30b68d20-6ba1-11e4-b3d9-550dc866dac4'
        }
    },
    limit: 50
}
```

Finally, perform an index on the `by_tid` secondary index:
```javascript
{
    table: 'example',
    index: 'by_tid',
    attributes: {
        tid: '30b68d20-6ba1-11e4-b3d9-550dc866dac4'
    },
    limit: 50
}
```

As you can see, these queries always select a contiguous slice of indexed
data, which is fairly efficient. The downside is that you can only query what
you indexed for.

## Alternative: REST URLs
Due to the tree structure of primary & secondary indexes, simple prefix
equality or range queries pretty naturally map to URLs like
`/example/Tom/foo`, or `/example//by_id/30b68d20-6ba1-11e4-b3d9-550dc866dac4`
for a secondary index query (note the `//` separator). More complex queries
could be supported with query string syntax like
`/example/Tom/foo/?le=30b68d20-6ba1-11e4-b3d9-550dc866dac4&limit=50`.

The current implementation uses the JSON syntax described above exclusively
(as GET or POST requests with a body), but for external APIs the URL-based API
looks very promising. This is not yet implemented, and needs more thinking
though of all the details before we expose a path-based API externally. 
