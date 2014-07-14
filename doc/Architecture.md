Bucket access restrictions
==========================
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


Data Flow
=========
- Normal read / most requests: go directly to storage
- On edit / storage miss: coordinate request in restface handler

## Going through RestFace *on edit / storage miss*
### Pros
- Central description of data flow (sequential code)
- error handling, logging: can do so all in RestFace, know which service failed
- centralized place to handle retries
- separation of concerns
    - for example, only single save pipeline per bucket which can enforce
      sanitization etc
- can build atomic storage operations from several service results
- consistent backend mapping
- can later push some of this handling to a lower-level hierarchy where it
  makes sense for perf
- keeps individual services simple (simple requst - reply pattern)

### Disadvantages
- Less efficient; might need to forward private data (like data-parsoid) to
  storage service
- need to return multi-part response {html,data-mw,data-parsoid}, but otoh
  html & data-mw needed anyway
- might need some kind of key per handler x bucket
    - although same would be true for other services

Use cases
=========

Parsoid: 
  GET html, data-parsoid, data-mw, wikitext
  POST html, wikitext, json (transactions)


## POST html, data-mw to RestFace

### Initial flow: Re-parse to wikitext
```
RestFace -> Parsoid
         <- wikitext
RestFace {wikitext} -> MW API
RestFace -> Parsoid
         <- {html,data-parsoid,data-mw}
RestFace -> Storage Service: {wikitext,html,data-mw,data-parsoid}
    signed by RestFace
        signature per handler?
```

### Longer term: Go direct
```
RestFace {html,data-mw} -> HTML sanitizer
         <- {html,data-mw} / signed by sanitizer
RestFace {html,data-mw} -> Storage Service
```

### Alternative: Write-through
```
RestFace {html,data-mw} -> Parsoid 
    {wikitext,sanitized html, data-mw, data-parsoid} -> Storage Service
    <- {sanitized HTML,revision}
```

## Namespacing: separate storoid / svc prefix
### Advantages
- makes mapping onto backend easy (storoid backend)
- rules out conflicts, can create arbitrary buckets
- clean urls for both buckets & services, no need for special prefixes
- could map DNS to different backends
    - although use case questionable; can also map popular entry points to
      different backend in Varnish

### Disadvantages
- Not 100% obvious what's a service & what storage -- users should not care
- Most entry points habe bits of both
- Converting one to the other would imply name change

### Pure service use cases: don't use storoid
- search / action=query type stuff
- citation service; actually likely to use storage later (cache)
- PHP API:
    - feeds: recent changes, contributions
    - purge
    - emailuser
    - globalblock
    - abusefilter\*
    - pagetriage\*
    - titleblacklist

### Other considerations
- Still need a separation between public buckets (pages etc) and private ones
- Prefix by `_feature`
```
/_search_foo/
```

## Integrating RestFace & Storoid
### Advantages
- Lower latency on fast / common read path

### Disadvantages
- Potential for higher store read latency if expensive operations are
  performed in main workers
    - but also true if all store requests are routed through restface
    - address this with separate threads / servers for expensive ops

### Challenges
- want a clearly defined interface between front-end & back-end code, so that
  we could separate the two later

