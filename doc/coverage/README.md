# Code coverage

It's a rare project that maintains 100% code coverage, but in general we want to keep coverage as high as we can.  This helps maintain a semi-formal specification of our software by enumerating the various use cases, and tracks which areas of the code are used to service the use cases.

This also reveals areas of the code that are not used to service the specified use cases, which we want to know about so that we can either purge the dead code, or formalize and validate the use cases implied by the uncovered code.

## Improving code coverage

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

![test](https://raw.githubusercontent.com/wikimedia/restbase/a1970a2eb256c35a4e925d6dcb572c0716140016/doc/coverage/test.png)

The test passes, so let's generate a new coverage report:

```
npm run-script coverage
```

![coverage](https://raw.githubusercontent.com/wikimedia/restbase/a1970a2eb256c35a4e925d6dcb572c0716140016/doc/coverage/coverage.png)

Now we can verify that `putLatestFormat()` is now covered:

![green](https://raw.githubusercontent.com/wikimedia/restbase/0d54160dc5d4ee8aa07adb9f58262ac97d7c07a4/doc/coverage/green.png)

Not only have we increased our code coverage, but we have reverse-engineered a specification for how a user can submit (and later retrieve) the latest format for some page content.

We have also drawn attention to an interesting implementation detail: that in this case a PUT request results in a 201 status, which might hint that this ought to instead use a POST request.  In any case, we have a point of reference for future design discussions and refactoring efforts.

## Publishing code coverage

In RESTBase, we build on [Travis CI](https://travis-ci.org/wikimedia/restbase/) and report coverage to [Coveralls](https://coveralls.io/r/wikimedia/restbase).

Not only does this keep us informed of the build status of each [pull request](https://github.com/wikimedia/restbase/pull/115), it lets us know via pull request comments how our changes affect the code coverage.

![pr coverage status](https://raw.githubusercontent.com/wikimedia/restbase/ca8e4107d30945a10303f29b5ba2af26bf9ec8d4/doc/coverage/pr_coverage_status.png)

To enable code coverage reporting, make the [following changes](https://github.com/wikimedia/restbase/pull/91/files):

**package.json**

*Add a couple new npm scripts:*

```javascript
"scripts": {
  "coverage": "istanbul cover _mocha --report lcovonly -- -R spec",
  "coveralls": "cat ./coverage/lcov.info | coveralls && rm -rf ./coverage"
}
```

*Add istanbul, mocha-lcov-reporter, and coveralls as dev dependencies:*

```javascript
"devDependencies": {
  "istanbul": "0.3.5",
  "mocha-lcov-reporter": "0.0.1",
  "coveralls": "2.11.2"
}
```

**.travis.yml**

*Tell Travis how to generate coverage info and send it off to Coveralls:*

```yaml
script: npm run-script coverage && npm run-script coveralls
```

Now when you submit a pull request, Travis builds your code and reports coverage info to Coveralls.  Coveralls comments on your pull request, and creates some nice reports on its site:

![coveralls job](https://raw.githubusercontent.com/wikimedia/restbase/ca8e4107d30945a10303f29b5ba2af26bf9ec8d4/doc/coverage/coveralls_job.png)

![coveralls files](https://raw.githubusercontent.com/wikimedia/restbase/ca8e4107d30945a10303f29b5ba2af26bf9ec8d4/doc/coverage/coveralls_files.png)
