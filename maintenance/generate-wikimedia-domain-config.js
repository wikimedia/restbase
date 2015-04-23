#!/usr/bin/env node

/**
 * Simple script to update sitematrix.json
 */

"use strict";
var P = require('bluebird');

var fs = require("fs"),
	writeFile = P.promisify(fs.writeFile),
	request = P.promisify(require('request')),
	downloadUrl = "https://en.wikipedia.org/w/api.php?action=sitematrix&format=json",
	filename = "sitematrix.json";

request({
	url: downloadUrl,
	json: true
})
.spread(function(res, body) {
	if ( res.statusCode !== 200 ) {
		throw "Error fetching sitematrix! Returned " + res.statusCode;
	}
    var sm = body.sitematrix;
    var projects = {
        wikipedia: [],
        wiktionary: [],
        wikiquote: [],
        wikisource: [],
        wikibooks: [],
        wikinews: [],
        wikiversity: [],
        wikivoyage: [],
        '*': []
    };
    Object.keys(sm).forEach(function(k) {
        var lang = sm[k];
        if (lang.site) {
            lang.site.forEach(function(site) {
                if (site.closed === undefined) {
                    var domain = site.url.replace(/^https?:\/\//, '');
                    var name = domain.replace(/[^.]+\.(\w+)\.org$/, '$1');
                    if (projects[name]) {
                        projects[name].push(domain);
                    } else {
                        projects['*'].push(domain);
                    }
                }
            });
        }
    });

    Object.keys(projects).forEach(function(name) {
        console.log('\n    # ' + name);
        projects[name].forEach(function(domain) {
            console.log('    /{domain:' + domain + '}: *wp/default/1.0.0');
        });
    });
});
