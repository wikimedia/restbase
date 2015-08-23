# Declarative proxy handler definition
- Provide a clear spec of the request flow for a given entry point
- Abstract common operations
- Make it easy to port to another environment later

Example for a bucket handler:
```yaml
---
/v1/{domain}/pages/{title}/html{/revision}:

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
    produces: text/html;profile="mw.org/specs/html/1.0"

    request_handler:
    - if:
        request.headers.cache-control:
            matches: /no-cache/i # regexp match
      then: &updateHTML # name the HTML update handler, so that we can ref it
        - send_request:
            method: GET
            url: | # Long URLs can be written as multi-line yaml syntax
                /v1/{request.params.domain}/_/parsoid/
                {request.params.domain}/{request.params.title}
            headers: $request.headers
            query:
              oldid: $request.params.revision
          on_response:
          - if:
              response.status: 200
            then: 
            - send_request:
                method: PUT
                headers: $response.headers
                body: $response.body
            - return: $response
          - else:
            - return: $response
    - else:
      - send_request: $request
        on_response:
        - if:
            response.status: 404
          then: *updateHTML # Call the HTML update handler above
        - else:
          - return: $response

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
      - text/html;profile="mediawiki.org/specs/html/1.0"
      - application/json;profile="mediawiki.org/specs/pagebundle/1.0"

    request_handler:
    - send_request: 
        # Sanitize the HTML first, and create derivate content like wikitext
        method: POST
        # Forward to internal service for processing
        url: |
            /v1/{request.params.domain/_/sanitizer/
            {request.params.title}{/request.params.revision}
        headers: $request.headers
        body: $request.body
      on_response:
      - if:
          response.status: 200
          response.headers:
            content-type: application/json;profile="mw.org/spec/requests"
          # The backend service returned a JSON structure containing a request
          # structure (a HTTP transaction). Execute it & return the response.
        then:
        - send_request: $response.request
          on_response:
          - return: $response
      - else:
        - return: $response
```
