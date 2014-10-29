#Declarative Proxy Handler

Defination:

defination here

#Data Flow

```

handler defination (yaml file)
 |
 V
Custom Interpreter
 |
 V
restbase

```
# Implementation

Interpreter

Interpreter will accept the yaml cofig file as input and will fetch the info accordingly. The main section we are interested in is request_handler. 

request_handler will look something like 

```yaml
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
```
Interpreter will convert this into an actual code.

```javascript
listBuckets = function (restbase, req) {
    // send request
    restbase.get(req);
    .then(function(res) {
        if ( status === 404 ) {
            restbase.get(
                uri: '/v1/parsoid/{domain}/{title}',
                hearers: req.headers,
                query { oldid : revision }
            );
            .then(funciton(res) {
                if (satus === 200) {
                    restbase.put(
                        uri: '/v1/parsoid/{domain}/{title}',
                        hearers: req.headers,
                        body: req.body,
                    );
                } else {
                    return res;
                }
            })
        } else {
            return res;
        }
    });
}
```

# Logical Mapping

* GET <=> Send a GET request
* PUT <=> Send a PUT request
* send_request <=> Makes a Call to restbase.request()
* on_request <=> Becomes a .then
* method <=> method for the request
* url, body, headers <=> paramerters to the send_request function
* if .. else <=> converts to if, else conditonal