% SOA proliferation through specification
% James Earl Douglas
% [MediaWiki Developer Summit 2015](https://www.mediawiki.org/wiki/MediaWiki_Developer_Summit_2015)

## Thesis

Service development and consumption flourishes in a well-specified ecosystem.

## Agenda

* Background
* Examples
* Roadmap

## Background

. . .

* Service-oriented architecture
* Specification
* Specification formats
* Swagger

## Service-oriented architecture

**Feature stew**

See also: the [join calculus](https://en.wikipedia.org/wiki/Join-calculus)

**Composable units of functionality**

* `foo`
* `bar`
* `baz = foo ∘ bar`

## Specification

**Establish boundaries**

* Limit the set of features
* Limit the scope of each feature

**Describe the interface**

*"To foo a bar, you must provide a baz,  and you will receive a qux."*

## Specification formats

* [IETF RFC](https://en.wikipedia.org/wiki/Request_for_Comments)
* [MW RFC](https://www.mediawiki.org/wiki/Requests_for_comment)
* [WSDL](https://en.wikipedia.org/wiki/Web_Services_Description_Language)
* [WADL](https://en.wikipedia.org/wiki/Web_Application_Description_Language)
* [RAML](https://en.wikipedia.org/wiki/RAML_%28software%29)
* [API Blueprint](http://apiblueprint.org/)
* [Swagger](http://swagger.io/)

## Swagger

<p style="margin-left: auto; margin-right: auto; width: 95%; height: 70%">
  <iframe width="100%" height="100%" src="http://wikimedia.github.io/restbase/v1/swagger.json"></iframe>
</p>

[*http://wikimedia.github.io/restbase/v1/swagger.json*](http://wikimedia.github.io/restbase/v1/swagger.json)

## Examples

. . .


* Swagger UI
* Swagger static documentation
* Swagger client generation
* Test automation

## Swagger UI

<p style="margin-left: auto; margin-right: auto; width: 95%; height: 70%">
  <iframe width="100%" height="100%" src="http://wikimedia.github.io/restbase/"></iframe>
</p>

[*http://wikimedia.github.io/restbase/*](http://wikimedia.github.io/restbase/)

## Swagger static documentation

<p style="margin-left: auto; margin-right: auto; width: 95%; height: 70%">
  <iframe width="100%" height="100%" src="http://wikimedia.github.io/restbase/v1/"></iframe>
</p>

[*http://wikimedia.github.io/restbase/v1/*](http://wikimedia.github.io/restbase/v1/)

## Swagger client generation

```javascript
var httpsync = require('httpsync');
var codegen  = require('swagger-js-codegen').CodeGen;
var fs       = require('fs');

var specUrl  = 'http://wikimedia.github.io/restbase/v1/swagger.json';
var response = httpsync.get(specUrl).end();
var swagger  = JSON.parse(response.data.toString());

var clientJs = codegen.getNodeCode({ className: 'RESTBase', swagger: swagger });
fs.writeFileSync('client.js', clientJs);
```

## Swagger-generated client

```javascript
var RESTBase = (function() {
    RESTBase.prototype.listRevisions     = function(parameters) { // ...
    RESTBase.prototype.getLatestFormat   = function(parameters) { // ...
    RESTBase.prototype.getFormatRevision = function(parameters) { // ...
    RESTBase.prototype.getFormatRevision = function(parameters) { // ...
    // ...
})();

exports.RESTBase = RESTBase;
```

## Test automation

**Swagger is exensible**

* Augment spec with request/response pairs
* Use them generated documentation
* Use them in automated tests

```javascript
"x-amples": [
  {
    "request": {
      "params": {
        "domain": "en.wikipedia.test.local",
        "title": "Foobar"
      }
    },
    "response": {
      "status": 200,
      "headers": {
        "content-type": "text/html;profile=mediawiki.org/specs/html/1.0.0"
      }
    }
  }
]
```

## Roadmap

. . .


* Where we're going
* How we'll get there

## Where we're going

**Happy users**

Features delivered as desired.

**Excited developers**

Empowered to build and deliver awesomeness.

**Rainbows and ponies for all**

OMG!!  Ponies!!

## How we'll get there

**Q) How do we stay on track?**

*A) Specify it.*

**Spec has to be reliable**

* v1 can change within in the philosophy of SemVer
* v2 can change anything it wants

**Spec-first vs. spec-last**

* Hitting the ground running vs. blocking by backend
* Deliberate vs. accidental

## References

* [Semantic Versioning](http://semver.org/)
* [Design by contract](https://en.wikipedia.org/wiki/Design_by_contract)
* [Swagger](http://swagger.io/)
* [swagger-js-codegen](https://github.com/wcandillon/swagger-js-codegen)
* [You are what you document](http://brikis98.blogspot.com/2014/05/you-are-what-you-document.html)

## Discussion

* How do you document your APIs?
* How do you enforce your specifications?
* Does your documentation catch up to your code?
* Does your code catch up to your documentation?
* What are your favorite Web services?
* What are your favorite APIs?
