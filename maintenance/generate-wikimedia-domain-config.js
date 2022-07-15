#!/usr/bin/env node

/**
 * Simple script to update sitematrix.json
 */

'use strict';

const preq = require('preq');
const downloadUrl = 'https://en.wikipedia.org/w/api.php?action=sitematrix&format=json';

preq.get({
    uri: downloadUrl
})
.then((res) => {
    const sm = res.body.sitematrix;
    const projects = {
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
        const lang = sm[k];
        if (lang.site || k === 'specials') {
            const sites = lang.site || lang;
            sites.forEach((site) => {
                if (site.closed === undefined && site.private === undefined) {
                    const domain = site.url.replace(/^https?:\/\//, '');
                    const name = domain.replace(/[^.]+\.(\w+)\.org$/, '$1');
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
