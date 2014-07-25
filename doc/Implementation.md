RestFace Implementation
=======================

Data flow inside RestFace
-------------------------
```
frontend handler
-> frontend req handlers
-> request opts
-> getHandler
-> backendHandler()
  handler can use retrying request wrapper
```

### When to go to the backend
when it would match the same front-end handler function


API docs
--------
- swagger most popular by far
    - some mock tools
    - bottom-up
- alternatives: RAML, API-Blueprint
    - http://www.slideshare.net/SmartBear_Software/api-strat-2014metadataformatsshort
    - http://apiux.com/2013/04/09/rest-metadata-formats/
    - JSON schema hypermedia http://json-schema.org/latest/json-schema-hypermedia.html


Goals for request library
--------------------------
- retrying request wrapper
- more consistent API
  can use request data for new request or response ('echo')

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
        primary: {
            method: 'PUT',
            uri: '/v1/bucket/foo/html',
            headers: {
                'Content-type': 'text/html',
                // ETag used as deterministic uuid by server
                'ETag': '<uuid>'
            },
            // string body by default
            body: "<html>...</html>"
        },
        dependents: [
            // should be idempotent
            {
                method: 'PUT',
                uri: '/bar/<uuid>',
                headers: {
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
        primary: {
            status: 200,
            body: 'response body',
            headers: {
                ...
            }
        },
        dependents: [
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
