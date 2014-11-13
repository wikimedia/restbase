# Declarative proxy handler definition
- Provide a clear spec of the request flow for a given entry point
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
