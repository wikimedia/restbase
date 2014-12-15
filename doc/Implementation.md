# RESTBase Implementation

## Code structure
- modules in separate npm packages
    - `restbase-tables-cassandra`
    - `restbase-queues-kafka`
    - `restbase-mod-parsoid`

Tree:
```
restbase.js
lib/
    storage.js
    util.js
# XXX: not quite final yet
config.yaml
interfaces/
    restbase/
        sys/
            key_rev_value.yaml
            key_rev_service.yaml
            table.yaml # defining operationIds, which map to module exports
    mediawiki/
        v1/
            content.yaml
        sys/
            parsoid.yaml
            page_revision.yaml
doc/
test/
```

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
The URI of the resource. Required. Can be a string, or a `swagger-router.URI` object.

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
