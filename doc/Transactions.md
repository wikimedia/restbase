# Lightweight HTTP transaction requests
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
    method: 'PUT',
    uri: '/v1/en.wikipedia.org/transactions/<timeuuid>',
    headers: {
        'Content-type':
            'application/json;profile="https://mediawiki.org/schema/transaction"',
        // Precondition for the entire transaction for idempotency
        // tids older than the normal transaction entry lifetime are rejected
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
                    'content-type':
                      'application/json;profile="https://mediawiki.org/specs/foo"'
                },
                // Objects implicitly serialized to JSON
                body: {..}
            },
            // binary content using base64 encoding (blame JSON)
            {
                method: 'PUT',
                uri: '/bar/<hash>.png',
                headers: {
                    'content-type': 'image/png',
                    'content-transfer-encoding': 'base64'
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
            'application/json;profile="http://mediawiki.org/schema/transaction_response"'
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

## Transaction execution and retry
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

### Recovery after coordinator failure
Other requests check the transaction table for old transactions from other
processes. If an old transaction is found, it is retried:

1. Re-execute the primary request.
    - On condition failure, check existence of entity suggested by ETag.
      Return success if that exists, failure otherwise.
2. Follow normal execution procedure (3 onwards)

### Figuring out the transaction state from a disconnected client
A `GET /v1/transactions/<uuid>` will return
- 40x if the uuid is too far in the past (short TTL)
- 404 if the transaction was never performed
- 200
    - the original transaction is returned if it was not yet executed
    - otherwise, the transaction result is returned
