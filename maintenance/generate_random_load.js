"use strict";

const preq = require('preq');
const P = require('bluebird');

const restbaseUri = process.argv[2];
const testRestBASEUri = process.argv[3];

function makeCheck() {
    return preq.get(`${restbaseUri}/page/random/title`)
    .then((res) => {
        const title = res.body.items[0].title;
        return preq.get(`${restbaseUri}/page/title/${encodeURIComponent(title)}/`)
        .then((res) => {
            const revision = Number.parseInt(
                res.body.items[Math.floor(Math.random() * res.body.items.length)], 10
            );
            return preq.get(`${testRestBASEUri}/page/html/${encodeURIComponent(title)}/${revision}`)
            .then((res) => {
                const tid = res.headers.etag.match(/\/(.+)"$/)[1];
                console.log(`Testing for ${title}/${revision}/${tid}`);
                P.delay(Math.floor(Math.random() * 86400000))
                .then(() => {
                    return P.all([
                        preq.get(`${testRestBASEUri}/page/html/${encodeURIComponent(title)}/${revision}/${tid}`)
                        .catch((err) => {
                            console.log(`${new Date()} Failed to fetch HTML ${title}/${revision}/${tid} from test RB: ${err}`);
                        }),
                        preq.get(`${testRestBASEUri}/page/html/${encodeURIComponent(title)}/${revision}/${tid}`)
                        .catch((err) => {
                            console.log(`${new Date()} Failed to fetch Data-Parsoid ${title}/${revision}/${tid} from test RB: ${err}`);
                        })
                    ]);
                });

                return P.delay(500).then(makeCheck);
            }, (e) => {
                console.log(`${new Date()} Failed to fetch HTML ${title}/${revision} from test RB: ${e}`);
            });
        });
    });
}

makeCheck();
