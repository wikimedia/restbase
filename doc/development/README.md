# Test-driven development process

*Note: this document is not a guideline; it is a collection of notes about a development process that works well for me (James) and might be handy for others too.*

## Goals

The primary motivation for TDD is to be intentional about development: to have a clear understanding of what has been built, and what is being built.

## Process overview

1. Identify a feature to be developed
2. Figure out how the user will interact with it
3. Write a test that exercises this user story
4. Make the test pass

## Example

First, let's identify a feature to be developed.  For this example, we'll choose the `no-cache` variation of [on-demand generation of HTML and data-parsoid](https://phabricator.wikimedia.org/T75955):

> For a no-cache request, RESTBase instead first checks whether the *current* revision is found in storage. If it is, it sends the data for that in the original key:
> 
> ```
> POST /v2/{domain}/html/{name}/{revision}
>
> {
>     original: {
>         revid: 12345, // The original revision ID
>         html: {
>             headers: {
>                 'content-type': 'text/html;profile=mediawiki.org/specs/html/1.0.0'
>             },
>             body: "the original HTML"
>         }
>         'data-parsoid': {
>             headers: {
>                 'content-type': 'application/json;profile=mediawiki.org/specs/data-parsoid/0.0.1'
>             },
>             body: {}
>         }
>     }
> }
> ```
>
> This entry point returns both html and data-parsoid in one JSON blob, which restbase stores in html and data-parsoid buckets, and also returns to the client.

Next, let's think about how the user will interact with this feature.  It should be a pretty simple case of sending a GET HTTP request to *GET /{domain}/v1/page/{name}/html/{revision}* with the `cache-control` header set to `no-cache`:

```javascript
return preq.get({
    uri: 'http://localhost:7231/v1/en.wikipedia.test.local/pages/Main_Page/html/139993',
    headers: {
        'cache-control': 'no-cache'
    },
})
```

The user should then expect a response as described above.  Let's verify the response body:

```javascript
.then(function (res) {
    assert.deepEqual(res.status, 200);
    assert.deepEqual(localRequestsOnly(), false);
    assert.deepEqual(wentToParsoid(), true);
    var resBody = JSON.parse(res.body);
    assert.deepEqual(resBody.headers, {
        "content-type": "text/html;profile=mediawiki.org/specs/html/1.0.0"
    });
    assert.deepEqual(/^<!DOCTYPE html>/.test(resBody.body), true);
    assert.deepEqual(/<\/html>$/.test(resBody.body), true);
});
```

Finally, let's implement the code needed to make this test pass:

```javascript
if (req.headers && /no-cache/.test(req.headers['cache-control'])) {
    var tid = uuid.v1();
    return generateAndSave(restbase, domain, bucket, key, format, revision, tid);
} else {
    // ...
}
```
