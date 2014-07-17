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
    uri: '/v1/foo', -- required
    -- optional from here
    method: 'GET', -- default: 'GET',
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
    body: 'Hello world', -- default: ''
    status: 200, -- default: 200
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
execution is conditional on a primary request suceeding. Typically the primary
request is made conditional using HTTP `If-Match`, `If-None-Match` and similar
headers. This allows for atomic updates to a primary entity while avoiding
*lost updates*.

The collection of requests is encoded as JSON, reusing the request spec above:
```javascript
{
    method: 'POST',
    uri: '/v1/bucket/foo',
    headers: {
        'Content-type':
            'application/json;profile=https://mediawiki.org/schema/transaction'
    },
    body: {
        primary: {
            method: 'PUT',
            uri: '/v1/bucket/foo',
            headers: {
                'If-Match': 'abcde',
                'Content-type': 'text/html'
            },
            // string body by default
            body: "<html>...</html>"
        },
        dependents: [
            {
                method: 'PUT',
                uri: '/bar',
                headers: {
                    'Content-type':
                      'application/json;profile=https://mediawiki.org/specs/foo'
                },
                // inline json support?
                body_json: {..}
            },
            // binary content using base64 encoding
            {
                method: 'PUT',
                uri: '/bar/image.png',
                headers: {
                    'Content-type': 'image/png',
                    'Content-transfer-encoding': 'base64'
                },
                body: 'aGVsbG8gd29ybG..'
            }
        ]
    }
}
```

Within restface, the base64 transfer-encoding is automatically managed for
Buffer `body` objects in a JavaScript HTTP transaction object.
