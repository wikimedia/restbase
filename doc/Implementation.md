# RESTBase Implementation

## Code structure
- storage backends in separate npm packages
    - `restbase-tables-cassandra`
    - `restbase-queues-kafka`

Tree:
```
restbase.js
lib/
    storage.js
    util.js
    proxy_handlers/
        global/
            network.js
            parsoid.js
        buckets/
            kv_rev/
            wikipages/
# XXX: not quite final yet
conf/
    restbase.yaml
    proxy_handlers/
        global/
        buckets/
    projects/
        # projects enable grouping of restbase configs per project
        someproject/
            global/
            buckets/
                # kv:.pages.html.yaml -- kv bucket named 'html'
                # pagecontent:.pages.yaml -- pagecontent buckets named 'pages'
doc/
test/
```

### Bucket & proxy handler config
- global & per domain
- FS: conf/global and conf/{domain}/
    - doesn't scale too well, but integrates with code review, deploy testing
      & typical development style
- later, maybe: distributed through storage

### Routing
- global (or per-domain, later) proxy handler routeswitch
- if no or same match: forward to storage backend
    - checks domain & bucket
    - calls per-bucket-type routeswitch with global env object
    - on request from handler:
        - if uri same (based on _origURI attribute): forward to table storage
            - need to select the right backend
        - else: route through proxy

#### Bucket / table -> storage backend mapping
- table registry
    - bucket type ('kv')
    - storage backend for table *with same name*
    - possibly no table storage associated - storage entry null
- flow through bucket to storage:
    1) call bucket routeswitch & handler
    2) on request with identical url, call underlying storage handler
        - need to know storage backend
        - hook that up on the proxy ahead of time (if not null), before
          calling bucket handler
    3) on requests to other tables, follow same procedure as above
        - lets us move each table to separate storage

## Internal request & response objects
### Request
```javascript
{
    uri: '/v1/foo', // required
    // optional from here
    method: 'GET', // default: 'GET',
    query: {
        q: 'some query parameter'
    }
    headers: {
        'Cache-control': 'no-cache'
    },
    body: 'Hello world'
}
```
#### `uri`
The URI of the resource. Required.

#### `method` [optional]
HTTP request method. Default `GET`. Examples: `GET`, `POST`, `PUT`, `DELETE`
etc.

#### `query` [optional]
Map of URI query parameters.

#### `headers` [optional]
Map of HTTP request headers.

#### `body` [optional]
Request data:
- `string` 
    - Incoming: Set for incoming requests with `text/*` content type. 
    - Outgoing: Sent as UTF8 string by default. `Content-Type` set to
      `text/plain` if not provided.
- `Buffer`
    - Incoming: Returned for non-text content types.
    - Outgoing: Sent as binary data if the content-type allows it. Default
      content type if not set: `application/binary`.
- `Object`
    - Incoming: `application/json` request or `POST` data
    - Outgoing: Sent as JSON. `Content-Type` set to `application/json` if not set.


### Response
```javascript
{
    body: 'Hello world', // default: ''
    status: 200, // default: 200
    headers: {
        'Cache-control': 'no-cache'
    }
}
```

#### `body` [optional]
Default value: Empty string.

Request data:
- `string`: Sent as UTF8 string by default. `Content-Type` set to `text/plain`
  if not provided.
- `Buffer`: If no `text/*` `Content-Type` set, sent as binary string with
  `Content-Type` of `application/binary`.
- `Object`: Sent as JSON. `Content-Type` set to `application/json` if not set.

#### `status` [optional]
The HTTP response status. 
- Number: `200`
- Array of status code & reason string: `[200,"OK"]`

#### `headers` [optional]
Map of response HTTP headers.


## API doc alternatives
- RAML
- API-Blueprint
- http://www.slideshare.net/SmartBear_Software/api-strat-2014metadataformatsshort
- http://apiux.com/2013/04/09/rest-metadata-formats/
- JSON schema hypermedia http://json-schema.org/latest/json-schema-hypermedia.html
