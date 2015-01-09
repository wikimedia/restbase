# Improving code coverage

It's a rare project that maintains 100% code coverage, but in general we want to keep coverage as high as we can.  This helps maintain a semi-formal specification of our software by enumerating the various use cases, and tracks which areas of the code are used to service the use cases.

This also reveals areas of the code that are not used to service the specified use cases, which we want to know about so that we can either purge the dead code, or formalize and validate the use cases implied by the uncovered code.

Let's find some uncovered code and add a test for it.

```
npm run-script coverage
```

Browsing the coverage report at *&lt;project&gt;/coverage/lcov-report/index.html*, we find some uncovered code:

![red](https://raw.githubusercontent.com/wikimedia/restbase/0d54160dc5d4ee8aa07adb9f58262ac97d7c07a4/doc/coverage/red.png)

It looks like we forgot to test `putLatestFormat()` in the pagecontent bucket handler.  Let's write a test for it:


*test/pagecontent/putLatestFormat.js:*

```javascript
describe('pagecontent bucket handler', function() {
    it('should allow the latest format to be submitted', function() {
        this.timeout(20000);
        return preq.put({
            uri: config.bucketURL + '/Main_Page/html',
            headers: { 'content-type': 'text/html' },
            body: 'this is the latest'
        })
        .then(function(res) {
            assert.deepEqual(res.status, 201);
            return preq.get({
              uri: config.bucketURL + '/Main_Page/html/' + res.headers.etag,
            });
        })
        .then(function(res) {
            assert.deepEqual(res.status, 200);
            assert.deepEqual(res.body, 'this is the latest');
        });
    });
});
```

That should do it.  Let's make sure it passes:

```
npm test
```

The test passes, so let's generate a new coverage report:

```
npm run-script coverage
```

Now we can verify that `putLatestFormat()` is now covered:

![green](https://raw.githubusercontent.com/wikimedia/restbase/0d54160dc5d4ee8aa07adb9f58262ac97d7c07a4/doc/coverage/green.png)

Not only have we increased our code coverage, but we have reverse-engineered a specification for how a user can submit (and later retrieve) the latest format for some page content.

We have also drawn attention to an interesting implementation detail: that in this case a PUT request results in a 201 status, which might hint that this ought to instead use a POST request.  In any case, we have a point of reference for future design discussions and refactoring efforts.
