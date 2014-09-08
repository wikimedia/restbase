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
      hash(nonce or (ssl?) session key | private_restface_key | bucket_path | handler_name)


# Data Flow
- Normal read / most requests: go directly to storage
- On edit / storage miss: coordinate request in restbase handler
    - call configured backend service, process compound response (JSON
      structure with requests / urls per part)

## Declarative configuration
- Limit restbase to very simple request routing for security & performance
- Abstract common operations
- Make it easy to port to another environment later
- See [issue #1](https://github.com/gwicke/restbase/issues/1) for a screenshot
  of swagger 2 in action

```yaml
--- # 
  /{domain}/pages/{title}/html{/revision}:
  
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
      x-restbase:
        on_response:
        - status: 404
          request:
          - method: GET # From Parsoid
            url: /v1/parsoid/{domain}/{title}
            headers: request.headers
            query:
              oldid: revision
            on_response:
            - status: 200
              return: response # Directly return the response
              request:
              - method: PUT # .. and store it back to storage
                headers: response.headers
                body: response.body
    
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
        - application/json;profile=mediawiki.org/specs/editbundle/1.0
      x-restbase:
        request: 
        # Sanitize the HTML first, and create derivative content like wikitext
        - method: POST
          # Forward to internal service for processing
          url: /_svc/sanitizer/{domain}/{title}{/revision}
          headers: request.headers
          body: request.body
          on_response:
          - status: 200
            headers:
              content-type: application/json;profile=mw.org/spec/requests
            # The backend service returned a JSON structure containing a request
            # structure (a HTTP transaction). Execute it & return the response.
            request:
            - execute: response.request
              on_response:
              - return: response
```

## Reasons for dispatching from restbase
- standardized data flow, retry & error handling, logging per backend
- combines documentation and execution spec in readable spec
- separation of concerns
    - for example, only single save pipeline per bucket which can enforce
      sanitization etc
- can build atomic storage operations from several independent service results
- consistent API to work against
- keeps individual services simple (simple requst - reply pattern)
- can later push some of this handling to Varnish (using declarative config)
  where it makes sense for perf
- low latency on fast / common read path by avoiding a network hop

### Challenges
- want a clearly defined interface between front-end & back-end code, so that
  we could separate the two later.
- Solution: Make storoid handler a restface backend handler using a HTTP
  request interface. The narrow HTTP interface makes it easy to run Storoid as
  a separate service later.


