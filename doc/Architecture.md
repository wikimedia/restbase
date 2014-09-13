# Data Flow

```
API Clients         Internet
 |
 V
 .----------------. RESTBase
 V                | 
Proxy Handlers    |            Proxy Layer
 |-> per-domain ->|
 |-> global     ->| <---> Backend services
 |-> bucket     ->' <---> MediaWiki
 | 
 | if no match or loop 
 |
 |-> table storage           Storage Layer
 '-> queue backend
```
- Normal read / most requests: go directly to storage
- On edit / storage miss: coordinate request in proxy handler
    - call configured backend service
    - process compound response (JSON structure with requests / urls per part)
        - mostly iterative processing for simplicity, consistent monitoring /
          logging etc

## Proxy layer
- Simple request routing and response massaging
- Dispatch layer for backend services

### Declarative proxy handlers
#### Swagger API spec
- Auto-generated documentation, sandbox, mocks / test clients
- See [issue #1](https://github.com/gwicke/restbase/issues/1) for a
  screenshot of swagger 2 in action

#### Declarative proxy handler definition
- Abstract common operations
- Make it easy to port to another environment later

Example for a bucket handler:
```yaml
---
# /{domain}/ prefix is implicit in bucket handlers
/{title}/html{/revision}:

  GET:
    # This is a valid Swagger 2.0 spec. Try at
    # http://editor.swagger.wordnik.com/.
    summary: Get the HTML for a revision.
    responses:
      200:
        description: The HTML for the given page and revision
      default:
        description: Unexpected error
        schema: { $ref: Error }
    produces: text/html;profile=mw.org/specs/html/1.0

    request_handler:
    - send_request: request
      on_response:
      - if:
          status: 404
        then:
        - send_request:
            method: GET
            url: /v1/parsoid/{domain}/{title}
            headers: request.headers
            query:
              oldid: revision
          on_response:
          - if:
              status: 200
            then: 
            - send_request:
                method: PUT
                headers: response.headers
                body: response.body
            - return: response
          - else:
            - return: response
      - else:
        - return: response
  
  PUT:
    summary: Save a new version of the HTML page
    responses:
      201:
        description: The new revision was successfully saved.
      default:
        description: Unexpected error
        schema: { $ref: Error }
    consumes:
      - text/html
      - text/html;profile=mediawiki.org/specs/html/1.0
      - application/json;profile=mediawiki.org/specs/pagebundle/1.0

    request_handler:
    - send_request: 
        # Sanitize the HTML first, and create derivate content like wikitext
        method: POST
        # Forward to internal service for processing
        url: /_svc/sanitizer/{domain}/{title}{/revision}
        headers: request.headers
        body: request.body
      on_response:
      - if:
          status: 200
          headers:
            content-type: application/json;profile=mw.org/spec/requests
          # The backend service returned a JSON structure containing a request
          # structure (a HTTP transaction). Execute it & return the response.
        then:
        - send_request: response.request
          on_response:
          - return: response
      - else:
        - return: response
```

### 1.1: Buckets
- provide pre-defined functionality / behavior and typically storage
- still participate in the proxy layer, so can perform requests to arbitrary
  backends
- let users override proxy handlers per domain & globally
    - example use cases: 
        - extend / filter listings & documentation
            - possibly interesting:
              https://tools.ietf.org/html/draft-ietf-appsawg-json-patch-10
              https://github.com/bruth/jsonpatch-js
            - alternative: chained JS expressions similar to templating
              `response.body.set('some.sub.path', {some:value}).delete('some.path')`
        - add custom handlers

#### Issue: documentation of dynamic buckets / backend handlers
- need to flatten structure for docs, per domain
- requests dynamic api spec by calling a spec_handler on proxy handlers, if defined
    - dynamic specs take precedence
- need to merge paths
    - strip the names for equality / sorting: `.replace(/({[\/?]?)[^}]*(})/g, '$1$2')`
    - difficult case: `/{foo}/bar{/baz}` vs. `/{foo}/{bar}{/baz}`
        - need to include both
    - luckily: `['{','a'].sort() -> [ 'a', '{' ]`
    - also use frontend / backend to break ties
        - add global & domain proxy handlers last, so that they override
- might need to strip / expand optional ones at the end ({/}) if
  there are overlapping shorter routes

#### Proxy handler levels
- cross domain
    - can project those down to per-domain
    - use case: define a global service *within each domain's namespace*
        - citoid, mathoid, parsoid
- per-domain
    - can use internal domains: `/v1/parsoid.svc.local/..`
- per-bucket / table
    - get front-end handlers per bucket at `?_spec` ?
    - need to update handlers / specs
        - on bucket creation / deletion
        - solution would be useful for docs as well
    - can also be cross-domain (`/v1/{domain}/pages/`)
        - can use this for optimization in front-end (share code if json is
          equal)

## Layer 2: Table storage service
- abstracts storage layer backend with a REST interface
- used by buckets, but can also (eventually) be directly exposed

### Other layering considerations
- can do significant massaging / backend-specific logic in backend handlers
    - example: unescape slashes in title for parsoid
    - lets us keep proxy handlers simple
    - consistent internal interface, but potentially different from external
      service interfaces
- property listings
    - not all sub-buckets should be shown
        - bucket proxy handler controls listing of regular sub-buckets
            - can use property on sub-buckets to decide whether to list them
            - alternatively, filter them in in a proxy handler


## Reasons for dispatching from restbase, and integrating with storage
- standardized data flow, retry & error handling, logging per backend
- combines documentation and execution spec in readable spec
- separation of concerns
    - for example, only single save pipeline per bucket which can enforce
      sanitization etc
- can build atomic storage operations from several independent service results
- consistent API to work against
- keeps individual services simple (request - reply pattern), ease of
  debugging
- can later push some of this handling to Varnish (using declarative config)
  where it makes sense for perf
- low latency on fast / common read path by avoiding a network hop

# Bucket access restrictions
Goals: 
- Allow fairly direct *read* access (bulk of requests)
- Unconditionally enforce group access at lowest level
- Enforce additional service processing constraints (sanitization etc) by
  limiting access to specific services

- grant bucket operation (read, edit) to [user group, (service x handler)]
    - user groups
    - some kind of request auth based on
        - private service key
        - bucket path
        - front-end handler name
        
    - should all be doable in the backend if handler name accessible
    - perhaps something like 
      hash(nonce or (ssl?) session key | private_restbase_key | bucket_path | handler_name)

See [the SOA authentication RFC](https://www.mediawiki.org/wiki/Talk:Requests_for_comment/SOA_Authentication).

# Error handling
Use [application/problem+json](https://tools.ietf.org/html/draft-nottingham-http-problem):
```json
{
 "type": "http://example.com/probs/out-of-credit",
 "title": "You do not have enough credit.",
 "detail": "Your current balance is 30, but that costs 50.",
 "instance": "http://example.net/account/12345/msgs/abc",
 "balance": 30,
 "accounts": ["http://example.net/account/12345",
              "http://example.net/account/67890"]
}
```
