# RESTBase Implementation

## Code structure
- modules in separate npm packages
    - `restbase-tables-cassandra`
    - `restbase-queues-kafka`
    - `restbase-mod-parsoid`

Tree:
```
restbase.js
lib/
    storage.js
    util.js
# XXX: not quite final yet
config.yaml
specs/
    restbase/
        sys/
            key_rev_value.yaml
            key_rev_service.yaml
            table.yaml # defining operationIds, which map to module exports
    mediawiki/
        v1/
            content.yaml
        sys/
            parsoid.yaml
            page_revision.yaml
doc/
test/
```

## Spec loading
Converts a spec tree into a route object tree, ready to be passed to
`swagger-router`. Can be passed into Router.addSpec as a handler.

- parameters:
    - spec

- check global nodeMap.get(spec)
    - if found, just use the existing sub-tree (`parentNode.set()`) and return
- specToTree: spec -> { children: []
  - look for
    - for each x-restbase directly inside of path entries (*not* inside of methods)
        - if `modules` is defined, load them and check for duplicate symbols
        - if `specs` is defined, load them and apply spec loader
            recursively, passing in modules and prefix path
        - if `resources` is defined, add them to a global list, with ref back
            to the original spec
            - call them later on complete tree (should we *only* do PUT?)
                - on error, complain really loudly and either bail out
                    completely or keep going (config)
                    - could also consider blacklisting modules / paths based
                        on this; perhaps re-build the tree unless we can
                        `.delSpec()` by then
    - for each x-restbase inside of methods inside of path entries
        - if `service` is defined, construct a method that resolves the
            backend path
            - else, check if `operationId` is defined in passed-in modules
        - in cases where we can be sure that the matching end point will
            be static, we can cache the result (with a method to map
            parameters, possibly inferred from a wildcard mapping or by
            passing in unique strings & looking for them in the final
            parameters)

Result: tree with spec nodes like this:
```javascript
{ 
    path: new URI(pathFragment),
    spec: specObj, // reference to the original spec object, for documentation
    value: valueObject,
    // optionally:
    children: [childObj, childObj], // child specs, one for each specs:
                                    // declaration
}
```

`valueObject` might look like this:
```javascript
{
    acl: {}, // TODO: figure out
    handler: handlerFn, // signature: f(restbase, req), as currently
    // more properties extracted from the spec as needed (ex: content-types
    // for sanitization)
}
```

For router setup, each path down the spec tree is passed to the router as an
array: `addSpecs([specRootNode, specNode2, specNode3])`. We *could* also pass
the entire tree, but that'd be less flexible for dynamic updates later.

In any case, passing in an array of spec nodes lets us check each spec node
for presence in the `_nodes` map before creating a subtree for it. This will
naturally establish sharing at the highest possible spec boundary. Dynamic
updates later without a full rebuild won't be trivial with sharing. A good
compromise could be to always rebuild an entire domain on any change. (So back
do passing trees, except that they are not the root tree?)

For ACLs the DAG structure is leveraged by checking ACLs all the way down the path.
This would allows us to restrict access at the domain level, for the entire domain,
while still sharing sub-trees. To avoid tight coupling of the router to the actual
ACL implementation we can have `lookup(path)` (optionally) return an array of all
value objects encountered in a successful lookup in addition to the actual lookup
result / leaf valueObject. Currently router returns a list of required permissions
collected along the path. In the spec, an ACL for a sub-path looks like this:

```yaml
paths:
  /{domain:en.wikipedia.org}:
    x-subspecs:
        - paths:
            /{api:v1}:
              x-subspec: *wp/content/1.0.0
              security: # list of required security requirement objects with permissions
                - mediawiki_auth
                    - read
```

The effective required capabilities (aka roles|scopes|..) for a given route
are the union of the path-induced ones with those defined on the route handler
itself. This means that path-based ACLs can only add to the required
capabilities for subtree access, effectively locking them down further. The
result should be fairly predictable behavior.

Most of the ACL customizations between different wikis would happen at the
authorization level anyway (mapping of identity to capabilities), which means
that tree ACLs don't absolutely need to differ between public and private
wikis.

TODO: Actually think this through more thoroughly.

### Request validation
Swagger spec could contain a specification of request parameters in `parameters` section.
The list of options is described in 
[Swagger Specification](https://github.com/swagger-api/swagger-spec/blob/master/versions/2.0.md#parameterObject)
On spec loading, `parameters` sections for each endpoint is picked up and compiled into a
request validator function, that it called before each request. If the some parameter didn't
match the specification, HTTP 400 error is returned without execution of a request handler.

## Internal request & response objects
### Request
```javascript
{
    uri: '/v1/foo', // required
    // optional from here
    method: 'GET', // default: 'GET',
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
The URI of the resource. Required. Can be a string, or a `swagger-router.URI` object.

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
```javascript
{
    body: 'Hello world', // default: ''
    status: 200, // default: 200
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


## API doc alternatives
- RAML
- API-Blueprint
- http://www.slideshare.net/SmartBear_Software/api-strat-2014metadataformatsshort
- http://apiux.com/2013/04/09/rest-metadata-formats/
- JSON schema hypermedia http://json-schema.org/latest/json-schema-hypermedia.html
