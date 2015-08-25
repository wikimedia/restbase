# Software development process

*Disclaimer: this document is in no way meant to be a mandate, or even a guideline; it's just a collection of notes about a development process that works well for me (James) and might be handy for others too.*

## Summary

Specification-driven development is super cool.  It focuses development efforts on clearly defining and confidently delivering the most important features to the users.

This process is really just a disciplined form of test-driven development, where the tests correspond directly to user experiences.

## Goal

The primary motivation for this process is to be intentional about development: to have a clear understanding of what has been built and what is being built.

For our purposes, a test corresponds to some discrete value for an identifiable stakeholder.  It can be a use case, user story, requirement, constraint, etc.

In this context, TDD does not mean "ensure that `getFoo()` and `setFoo(foo)` are green"; it means "ensure that user story X is (1) clearly defined in a testable way and (2) satisfied by our code".

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
>                 'content-type': 'text/html;profile="mediawiki.org/specs/html/1.0.0"'
>             },
>             body: "the original HTML"
>         }
>         'data-parsoid': {
>             headers: {
>                 'content-type': 'application/json;profile="mediawiki.org/specs/data-parsoid/0.0.1"'
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

The user should then expect a response as described above.  Let's [verify the response body](https://github.com/earldouglas/restbase/blob/56127d0f93034aa5e267bdce2d490c079052dfe3/test/features/parsoid/ondemand.js#L87):

```javascript
assert.deepEqual(res.status, 200);
assert.deepEqual(localRequestsOnly(slice), false);
assert.deepEqual(wentToParsoid(slice), true);
assert.deepEqual(res.headers['content-type'], 'text/html;profile="mediawiki.org/specs/html/1.0.0"');
assert.deepEqual(/^<!DOCTYPE html>/.test(res.body), true);
assert.deepEqual(/<\/html>$/.test(res.body), true);
```

As this is a Node project, we will run the test with npm:

```
npm test
```

As expected, this test doesn't pass, because we haven't yet written the code to make it pass:

![failing-test](https://raw.githubusercontent.com/wikimedia/restbase/7857c51dd596c68e5da38987846f767885d56969/doc/development/failing-test.png)

Finally, let's [implement the code](https://github.com/earldouglas/restbase/blob/56127d0f93034aa5e267bdce2d490c079052dfe3/lib/filters/global/parsoid.js#L66) needed to make this test pass:

```javascript
if (req.headers && /no-cache/.test(req.headers['cache-control'])) {
    var tid = uuid.v1();
    return generateAndSave(restbase, domain, bucket, key, format, revision, tid);
} else {
    // ...
}
```

Running `npm test` again, we see that the failing test now passes:

![passing-tests](https://raw.githubusercontent.com/wikimedia/restbase/7857c51dd596c68e5da38987846f767885d56969/doc/development/passing-tests.png)

## Triggered test execution

During the development process, there tend to be quite a few invocations of `npm test`, which can get tedious to do manually.  To make it easier on ourselves, let's make `npm test` run automatically whenever we make a change to our source code.  Toss the following into a bash environment:

*~/.bash_aliases:*

```
function fswatch() {
  while [ TRUE ]
  do
    $@
    inotifywait --exclude '\.git/.*' -e modify -e close_write -e moved_to \
                -e moved_from -e move -e move_self -e create -e delete    \
                -e delete_self -e unmount -qqr .
  done
}
```

Now instead of `npm test`, we can run `fswatch npm test` from our project directory, and it will trigger `npm test` every time we save a file.

To see what this looks like in practice, watch [this demo](http://vimeo.com/75100243) and pretend it shows `fswatch npm test` with Node instead of `sbt ~test` with Scala.
