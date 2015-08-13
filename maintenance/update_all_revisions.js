#!/usr/bin/env node

"use strict";
var P = require('bluebird');
var preq = require('preq');

var restBaseBaseUri = "https://rest.wikimedia.org/";

function getWikipediaDomainList() {
    return preq.get({
        uri: restBaseBaseUri
    })
    .then(function(res) { return res.body.items; });
}

function updateDomain(domain, next) {
    var pageUri = restBaseBaseUri + domain + '/v1/page/title/';
    if (next) {
        pageUri += next;
    }
    console.log('Starting page ' + pageUri);
    return preq.get({
        uri: pageUri
    })
    .then(function(res) {
        if (res && res.body && res.body.items) {
            console.log('Processing page of ' + domain + '. Page starts from article: "' + res.body.items[0] + '"');
            return P.all(res.body.items.map(function(title) {
                return preq.get({
                    uri: restBaseBaseUri + domain + '/v1/page/title/' + encodeURIComponent(title),
                    headers: {
                        'cache-control': 'no-cache'
                    }
                })
                .catch(function(err) {
                    if (err && err.status === 404) {
                        console.log('404 on ' + title);
                    } else {
                        console.error(JSON.stringify(err));
                    }
                });
            }))
            .then(function() {
                if (res.body._links && res.body._links.next) {
                    return updateDomain(domain, res.body._links.next.href)
                }
            });
        }
    })
    .catch(function(err) {
        console.error('ERROR', err);
    });
}

var startingDomain = process.argv[2];
var startingPage = process.argv[3];

getWikipediaDomainList()
.then(function(domains) {
    if (startingDomain) {
        var index = domains.indexOf(startingDomain);
        if (index < 0) {
            throw new Error('Invalid domain ' + startingDomain);
        }
        return domains.slice(index);
    }
    return domains;
})
.each(function(domain) {
    return updateDomain(domain, startingPage);
});
