RestFace Implementation
=======================

Data flow inside RestFace
-------------------------
```
frontend handler
-> frontend req handlers
-> request opts
-> getHandler
-> backendHandler()
  handler can use retrying request wrapper
```

### When to go to the backend
when it would match the same front-end handler function



API docs
--------
- swagger most popular by far
    - some mock tools
    - bottom-up
- alternatives: RAML, API-Blueprint
    - http://www.slideshare.net/SmartBear_Software/api-strat-2014metadataformatsshort
    - http://apiux.com/2013/04/09/rest-metadata-formats/
    - JSON schema hypermedia http://json-schema.org/latest/json-schema-hypermedia.html


Goals for request library
--------------------------
- retrying request wrapper
- more consistent API
  can use request data for new request or response ('echo')
