#Declarative Proxy Handler

Definition:

[Declarative proxy handlers definition] (https://github.com/gwicke/restbase/blob/master/doc/Architecture.md#declarative-proxy-handler-definition)

#Data Flow

```

handler definition (yaml file)
 |
 V
Declarative handler config get convered to a full restbase handler
 |
 V
restbase

```
# Implementation

Interpreter

Interpreter will accept the yaml cofig file as input. The main section we are interested in is request_handler. 

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

Interpreter will parse the yalm config and call corresponding predefined handler for each block, Eg - send_request will call 
send_request() handler


# Handlers


###On response block

```javascript
function handle_response(config, res) {
    for condition in cofig {
        if ( match_response(condition, res) ) {
            // execute then
            childHandler = handle_condition(config.then, res);
            break;
        } else {
            // execute corresponding else tree
            childHandler = handle_condition(config.else, res);
            break;
        }
    }
    return childHandler;
}
```

###Send request block

```javascript
function send_request(restbase, req) {
    return restbase.request(req);
}
```

###match_response

```javascript
function match_response(condition, res) {
    // execute condition against res
    // Eg. { status : 404 } will check if res['status'] === 404
    if (match) {
        return true   
    } else {
        return false
    }
}
```

###Conditional handler

```javascript
function handle_condition(config, res) {
    return new Promise(function(response, reject){
        if(Object.keys(config[0])==="send_reuquest" && Object.keys(config[1])==="on_response") {
            return send_reuquest(config.).then(handle_response.bind(self, config.on_response));
        } else if (Object.keys(config[0])==="send_request") {
            return send_request(config.send_request);
        } else if (Object.keys(config[0])==="if") {
            if ( match_response(config.if, res) ) {
                return handle_condition(config.then, res);
            } 
        }
    });
}
```

# Wrapper

A handler wrapper that will execute obove handlers will look something like

```javascript
function make_config_handler(restbase, config) {
    if(Object.keys(config[0])==="send_request" && Object.keys(config[1])==="on_response") {
        var handler = function handler(restabase, req) {
            return send_request(config.send_request).then(handle_response.bind(self, config.on_response))
        }
    }
    return handler
}
```
