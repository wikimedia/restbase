# Declarative request handler definition

## General madel
On each endpont there could be two high-level blocks: `x-backend-setup` and `x-backend-request`. 
The former is run during RESTBase start-up and is optional, while the latter is executed on every 
incoming request and can be made up of multiple requests (further referred to as request blocks).

## Setup declaration
The `x-request-setup` stanza could be used to set up storage or do any preparational requests needed on startup.
And example of a setup declaration:

```yaml
    /{module:service}/test/{title}{/revision}:
        get:
            x-backend-setup:
                - init_storage:
                    uri: /{domain}/sys/key_value/testservice.test            
```

By default `PUT` method is used for a request. This example would initialize a `testservice.test` bucket in a 
`key_value` module.

## Request Block

Each request block can be a control one, no special naming is used, as everything can be determined by the block's 
properties. A block's name is remembered and put in the current scope, so that is can be referenced in a later block; 
its reference is bound to the response returned for it. Therefore, request block names must be unique inside the same 
`x-backend-request` fragment.

A block is allowed to have the following properties:
- `request`: a request template of the request to issue in the current block
- `return`: a response template documenting the response to return
- `return_if`: a conditional stanza specifying the condition to be met for stopping the execution of the sequential chain
- `catch`: a conditional stanza specifying which error conditions should be ignored

## Execution Flow
It is mandatory that a block has either a `request`, a `return` stanza or both. When a `return` stanza is specified 
without a matching `return_if` conditional, the sequence chain is stopped unconditionally and the response is returned. 
In the presence of a `return_if` stanza, its conditional is evaluated and, if satisfied, the chain is broken; 
otherwise, the execution flow switches to the next block.

Errors are defined as responses the status code of which is higher than 399. When an error is encountered, 
the chain is broken, unless there is a `catch` stanza listing that status code, in which case the execution 
continues with the next block.

## Sequential and Parallel Blocks
The `on_request` fragment is an array of objects each of which is a named request block. 
All of the array elements are executed sequentially one by one until either the chain is broken 
(because of a `return`, `return_if` or an error) or the end of the array has been reached:

Example: 
```yaml
    on_request:
        - req_block1: ...
        - req_block2: ...
        - ...
        - req_blockN: ...
```
        
Should an array element contain more than one request block, they are going to be executed in parallel:

Example:
```yaml
on_request:
  - req_block1: ...
  - req_block2a: ...
    req_block2b: ...
  - ...
  - req_blockN: ...
```
  
Parallel request blocks cannot have the `return` or the `return_if` stanzas and cannot be the last element of 
the chain array.

## Outline
Here's the complete outline of the possible blocks/stanzas:

```yaml
x-backend-setup:
  - name1:
      uri: uri1
      method: m1
      headers:
        h1: v1
      body: body1
x-backend-request:
  - name1:
      request:
        method: m2
        uri: uri2
        headers:
          h2: v2
        body: body2
      catch:
        status: [404, '5xx']
    name2:
      request:
        method: m3
        uri: uri3
        headers:
          h3: v3
        body: body3
  - name3:
      request:
        method: m4
        uri: uri4
        headers:
          h4: v4
        body: body4
      return_if:
        status: ['2xx', 404]
  - name4:
      return: '{$.name2}'
```      
      
## POST Service Definition
Using this specification, we can define the POST service configuration as follows:

```yaml
  /posttest/{hash}/png:
    get:
      x-backend-setup:
        - setup_png_storage:
            method: put 
            uri: /{domain}/sys/key_value/postservice.png
      x-backend-request:
        - get_from_storage:
            request:
              method: get
              headers:
                cache-control: '{cache-control}'
              uri: /{domain}/sys/key_value/postservice.png/{hash}
             return_if:
               status: 200
             catch:
               status: 200
        - get_post:
            request:
              uri: /{domain}/sys/post_data/postservice/{hash}
        - new_png:
            request:
              method: post
              uri: http://some.post.service/png
              body: '{$.get_post.body}'
        - save_new_png:
            request:
              method: put
              uri: /{domain}/sys/key_value/postservice.png
              headers: '{$.new_png.headers}'
              body: '{$.new_png.body}'
        - return_png:
            return: '{$.new_png}'

  /posttest/:
    post:
      x-backend-setup:
        - setup_post_data_bucket:
            method: put
            uri: /{domain}/sys/post_data/postservice
      x-backend-request:
        - do_post:
            request:
              method: post
              uri: /{domain}/sys/post_data/postservice/
              body: '{$.request.body}'
```                      

With this configuration, upon a `POST` request, it's stored in the `post_data` module by hash, which is implicitly returned
to the client. Upon a get request, storage is checked for content. If there's no content in the storage, an original `POST`
request is loaded and sent to the backend service. The result is stored and returned to the client.