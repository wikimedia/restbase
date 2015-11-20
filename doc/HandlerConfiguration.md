# Declarative request handler definition

## General model
Each swagger end point can optionally define two declarative handlers:
`x-setup-handler` and `x-request-handler`.  `x-setup-handler` is run during
RESTBase start-up, while the `x-request-handler` is executed on every incoming
request, and can be made up of multiple sub-requests executed in a sequence of
steps.

Together, these handlers can make it easy to hook up common behaviors without
having to write code. If more complex functionality is needed, then this can
be added with JS modules, which can either take over the handling of the
entire request, or add handler-specific functionality to the handler
templating environment.

## Setup declaration
The `x-request-setup` stanza is typically used to set up storage or do any
preparational requests needed on startup.  And example of a setup declaration:

```yaml
    /{module:service}/test/{title}{/revision}:
        get:
            x-setup-handler:
                - init_storage:
                    uri: /{domain}/sys/key_value/testservice.test            
```

By default the `PUT` method is used for a request. This example would
initialize a `testservice.test` bucket in a `key_value` module.

## Request handlers

Request handlers are called whenever a request matches the swagger route &
validation of parameters succeeded. Here is an example demonstrating a few :

```yaml
x-request-handler:
  # First step.
  - wiki_page_history: # The request name can be used to reference the response later.
      request:
        method: get
        uri: http://{domain}/wiki/{+title}
        query:
          action: history

    # Second request, executed in parallel with wiki_page.
    view_data:
      request:
        uri: https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/{domain}/all-access/all-agents/Foobar/daily/20150907/20151101

  # Second step: Only defines a `composite` response for later use.
  - composite:
      response:
        headers:
          content-type: application/json
          date: '{{wiki_page_history.headers.date}}'
        body: 
          history_page: '{{wiki_page_history.body}}'
          first_view_item: '{{view_data.body.items[0]}}' # Only return the first entry

  # Third step: Saves the `composite` response to a bucket.
  - save_to_bucket:
      request:
        method: put
        uri: /{domain}/sys/key_value/testservice.test/{title}
        headers: '{{composite.headers}}'
        body: '{{composite.body}}'

  # Final step: Returns the `composite` response to the client.
  - return_to_client:
      return:
        status: 200
        headers: '{{composite.headers}}'
        body: '{{composite.body}}'
```
        
## Steps: Sequential execution of blocks of parallel requests.

A handler template is made up of several steps, encoded as objects in an
array structure. Each property within a step object describes a request and
its response processing. The name of this property should be unique across the
entire `x-response-handler`, as the responses are saved in a request-global
namespace.

Each request spec can have the following properties:
- `request`: a request template of the request to issue in the current block
- `catch`: a conditional stanza specifying which error conditions should be ignored
- `return_if`: Modifies the behavior of `return` to only return if the
    conditions in `return_if` evaluate to true.
- `return`: Return statement, containing a response object template. Aborts
    the entire handler. Unconditional if no `return_if` is supplied.
    Only a single request within a step can have `return` or `return_if` set.
- `response`: Defines a response template like `return`, but does not abort
    the step / handler.

## Execution Flow

Within each step, all requests (if defined) are sent out in parallel, and all
responses are awaited. If no `catch` property is defined, or if it does not
match, errors (incl. 4xx and 5xx responses) will abort the entire handler, and
possibly also parallel requests.

If all parallel requests succeed, each result is registered in the global
namespace. If `return_if` conditions are supplied, those are then evaluated
against the raw response value.

Next, `return` or `response` statements are evaluated. These have access to
all previous responses, including those in the current step. The `response`
template replaces the original response value with its expansion, while
`return` will return the same value to the client if no `return_if` stanza was
supplied, or if its condition evaluated to true against the original
responses.
