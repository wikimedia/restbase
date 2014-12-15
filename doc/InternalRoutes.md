# Issues
## Enforcing checks / transforms in write & read paths
- content sanitization: registry by mime type (from top-level swagger spec)
- ACLs:
    - default: check user perms at the table level
    - can delegate to other handlers: array of paths [patterns]?
    - can *require* other handlers in path to force use of single entry
        point
        - example: revision deletion check in revcontent

## Ownership of storage
- can infer from 'autocreate' in swagger specs on startup
- might want to remember which module created a table for forensics
    - can highlight tables that aren't owned by any module any more
- potential for multiple owners

## swagger-router
Switch to a tree-based lookup structure internally, one branch per path
segment.
- can avoid escaping internally (pass around an array)
- avoid lookup for backend routes by doing the lookup at compile time (or
    caching it)
- lets us support listings, domains: register a `list` handler for `/`,
    pass it `Object.keys` for sub-routes
- can be updated more efficiently than a regexp
    - throw exception when an existing route conflicts in addRoute
- perf should be okay, structure is shallow
- avoid any backtracking; instead, expand or share subtrees
- implementation idea: 
    - per domain, construct a tree (eval domain vs. regexps)
    - merge identical children
        - possibly using hash(keys, hash(each child)); leaf hash over
            - module name
            - path
            - method

- interface: 
    - `#addSpec(spec, [prefix])`
    - `#delSpec(spec, [prefix])`
    - `#lookup(path)`
    - path / prefix are strings or arrays

## Modules
- would be nice to distinguish public from private ones - naming convention
    `sys_table_storage`

# Multi-part responses: MIME message like encapsulation

```javascript
{
    html: {
        headers: {
            'content-type': 'text/html'
        },
        body: '<html>..</html>'
    },
    'data-parsoid': {
        headers: {
            'content-type': 'application/json'
        },
        body: {}
    },
    'binary-data': {
        headers: {
            'content-type': 'image/jpeg',
            'transfer-encoding': 'base64'
        },
        body: "SSBtdXN0IG5vdCBmZWFyLlxuRmVhciBpcyB0aGUgbWluZC1raWxsZXIuCg=="
    }
}
```

Alternative: http://www.w3.org/TR/html-json-forms/
