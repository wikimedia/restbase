RestFace Implementation
=======================

Data flow inside RestFace
-------------------------
```
frontend handler
-> Verbs.request 
    front-end router
    -> if match != current FE handler: call it
       else: try backend router
        -> if backend handler match: call it
```

### When to go to the backend
when it would match the same front-end handler function


## API docs
- swagger most popular by far
    - some mock tools
    - bottom-up
- alternatives: RAML, API-Blueprint
    - http://www.slideshare.net/SmartBear_Software/api-strat-2014metadataformatsshort
    - http://apiux.com/2013/04/09/rest-metadata-formats/
    - JSON schema hypermedia http://json-schema.org/latest/json-schema-hypermedia.html



## Request & response format
### Request
#### Request example
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
#### Response example
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


### Lightweight HTTP transaction requests
Status: Design draft. Feedback wanted.

Lightweight HTTP transaction requests are a collection of requests whose
execution is conditional on a primary request succeeding. Typically the primary
request is made conditional using HTTP `If-Match`, `If-None-Match` and similar
headers. This allows for atomic updates to a primary entity while avoiding
*lost updates*.

The transaction executor ensures that all dependent requests are performed
after a successful primary request, even if the executor goes down in the
middle of the transaction, or the client connection is lost.

The collection of requests is encoded as JSON, reusing the request spec above:
```javascript
{
    method: 'POST',
    uri: '/v1/transactions/<uuid>',
    headers: {
        'Content-type':
            'application/json;profile=https://mediawiki.org/schema/transaction',
        // precondition for the entire transaction
        'If-None-Match': '*'
    },
    body: {
        method: 'PUT',
        uri: '/v1/bucket/foo/html',
        headers: {
            'Content-type': 'text/html',
            // ETag used as deterministic uuid by server
            'If-Match': '<uuid>'
        },
        // string body by default
        body: "<html>...</html>"
        then: [
            // should be idempotent
            {
                method: 'PUT',
                uri: '/bar/<uuid>',
                headers: {
                    'if-match': '<uuid>',
                    'Content-type':
                      'application/json;profile=https://mediawiki.org/specs/foo'
                },
                // Objects implicitly serialized to JSON
                body: {..}
            },
            // binary content using base64 encoding
            {
                method: 'PUT',
                uri: '/bar/<hash>.png',
                headers: {
                    'Content-type': 'image/png',
                    'Content-transfer-encoding': 'base64'
                },
                // Binary data is transmitted as base64 string; Automatically
                // handled in restface for Buffer objects.
                body: 'aGVsbG8gd29ybG..'
            }
        ]
    }
}
```


The response mirrors the structure of the request object:
```javascript
{
    status: 200, -- status of primary request
    headers: {
        'Content-Type':
            'application/json;profile=http://mediawiki.org/schema/transaction_response'
    },
    body: {
        status: 200,
        body: 'response body',
        headers: {
            ...
        },
        then: [
            {
                status: 200,
                headers: {}
            },
            {
                status: 200,
                headers: {}
            }
        ]
    }
}
```

### Transaction execution and retry
1. Save transaction to a global transaction table
   `PUT /v1/transactions/<uuid>`
    - or use a queue to avoid accumulating a large number of tombstones
2. Try to execute primary request, passing in ETag if provided
    - Used by server for new revisioned content
3. Check primary request result.
    - Precondition failure: Delete transaction and return error to the client.
    - Success: Execute dependents unconditionally
4. Replace transaction with its response structure & a short TTL
5. Return success to client

#### Recovery after coordinator failure
Other requests check the transaction table for old transactions from other
processes. If an old transaction is found, it is retried:

1. Re-execute the primary request.
    - On condition failure, check existence of entity suggested by ETag.
      Return success if that exists, failure otherwise.
2. Follow normal execution procedure (3 onwards)

#### Figuring out the transaction state from a disconnected client
A `GET /v1/transactions/<uuid>` will return
- 40x if the uuid is too far in the past (short TTL)
- 404 if the transaction was never performed
- 200
    - the original transaction is returned if it was not yet executed
    - otherwise, the transaction result is returned

#### App-level consististency of secondary updates on retry
##### Use case: secondary index updates
**Update strategy**: Retrieve original data (if any) & figure out necessary index updates
by looking for changed indexed attributes. Schedule those as dependent updates
in an internal light-weight transaction.

**Challenge**: Retried index updates should not result in an inconsistent index.

Example execution:
1. T1 partly successful
2. T2 successful
3. T1 secondary updates retried
Results:
- possibly lost index entries if T1 removed entries that T2 added
- possibly extra index entries if T1 added entries that T2 removed

**Solution**: Assign a writetime to the entire transaction, and use this for
both the primary & all retried dependent updates. The fixed writetime makes
dependent updates idempotent. Re-execute dependents of both T1 and T2
in-order.
    
#### Similar libraries
- [DynamoDB transaction library](http://java.awsblog.com/post/Tx13H2W58QMAOA7/Performing-Conditional-Writes-Using-the-Amazon-DynamoDB-Transaction-Library)
