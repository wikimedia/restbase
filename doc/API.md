# API documentation
- Auto-generate Swagger 2 spec from handler / hook spec fragments
- Use standard swagger tools to generate documentation, sandbox, mocks / test clients
- See [issue #1](https://github.com/wikimedia/restbase/issues/1) for a
  screenshot of swagger 2 in action

## Issue: documentation of dynamic buckets / backend handlers
- need to flatten structure for docs, per domain
- requests dynamic api spec by calling a spec_handler on proxy handlers, if defined
    - dynamic specs take precedence
- need to merge paths
    - strip the names for equality / sorting: `.replace(/({[\/?]?)[^}]*(})/g, '$1$2')`
    - difficult case: `/{foo}/bar{/baz}` vs. `/{foo}/{bar}{/baz}`
        - need to include both
    - luckily: `['{','a'].sort() -> [ 'a', '{' ]`
    - also use frontend / backend to break ties
        - add global & domain proxy handlers last, so that they override
- might need to strip / expand optional ones at the end ({/}) if
  there are overlapping shorter routes

# Error handling
Use [application/problem+json](https://tools.ietf.org/html/draft-nottingham-http-problem):
```json
{
 "type": "http://example.com/probs/out-of-credit",
 "title": "You do not have enough credit.",
 "detail": "Your current balance is 30, but that costs 50.",
 "instance": "http://example.net/account/12345/msgs/abc",
 "balance": 30,
 "accounts": ["http://example.net/account/12345",
              "http://example.net/account/67890"]
}
```
