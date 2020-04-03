#!/usr/bin/env node

/**
 * Simple script to update sitematrix.json
 */

'use strict';

var preq = require('preq');
var downloadUrl = 'https://en.wikipedia.org/w/api.php?action=sitematrix&format=json';

preq.get({
    uri: downloadUrl
})
.then((res) => {
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
        '*': []
    };

    Object.keys(sm).forEach((k) => {
        var lang = sm[k];
        if (lang.site || k === 'specials') {
            var sites = lang.site || lang;
            sites.forEach((site) => {
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

    Object.keys(projects).forEach((name) => {
        console.log(`\n    # ${name}`);
        projects[name].forEach((domain) => {
            console.log(`    /{domain:${domain}}: *wp/default/1.0.0`);
        });
    });
});
