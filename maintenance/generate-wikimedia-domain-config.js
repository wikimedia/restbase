#!/usr/bin/env node

/**
 * Simple script to update sitematrix.json
 */

"use strict";
var P = require('bluebird');

var fs = require("fs");
var writeFile = P.promisify(fs.writeFile);
var preq = require('preq');
var downloadUrl = "https://en.wikipedia.org/w/api.php?action=sitematrix&format=json";
var filename = "sitematrix.json";

preq.get({
    uri: downloadUrl,
})
.then(function(res) {
    var sm = res.body.sitematrix;
    var projects = {
        wikipedia: [],
        wiktionary: [],
        wikiquote: [],
        wikisource: [],
        wikibooks: [],
        wikinews: [],
        wikiversity: [],
        wikivoyage: [],
        wikimedia: [],
        '*': [],
    };

    Object.keys(sm).forEach(function(k) {
        var lang = sm[k];
        if (lang.site || k === 'specials') {
            var sites = lang.site || lang;
            sites.forEach(function(site) {
                if (site.closed === undefined && site.private === undefined) {
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
