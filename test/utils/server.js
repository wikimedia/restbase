'use strict';

const P = require('bluebird');
const ServiceRunner = require('service-runner');
const logStream = require('./logStream');
const fs        = require('fs');
const assert    = require('./assert');
const yaml      = require('js-yaml');

const hostPort  = 'http://localhost:7231';
const baseURL   = `${hostPort}/en.wikipedia.org/v1`;
const globalURL = `${hostPort}/wikimedia.org/v1`;
const bucketURL = `${baseURL}/page`;
const secureURL = `${hostPort}/fr.wikipedia.org/v1`;
const secureBucketURL = `${secureURL}/page`;
const labsURL   = `${hostPort}/en.wikipedia.beta.wmflabs.org/v1`;
const labsBucketURL = `${labsURL}/page`;
const variantsWikiURL = `${hostPort}/sr.wikipedia.beta.wmflabs.org/v1`;
const variantsWikiBucketURL = `${variantsWikiURL}/page`;
const parsoidURI = 'https://parsoid-beta.wmflabs.org';

function loadConfig(path, forceSqlite) {
    let confString = fs.readFileSync(path).toString();
    const backendImpl = process.env.RB_TEST_BACKEND;
    if (backendImpl) {
        if (backendImpl !== 'cassandra' && backendImpl !== 'sqlite') {
            throw new Error('Invalid RB_TEST_BACKEND env variable value. Allowed values: "cassandra", "sqlite"');
        }
        if (backendImpl === 'cassandra') {
            confString = confString.replace(/backend: sqlite/, "backend: cassandra");
        }
    }
    if (forceSqlite) {
        confString = confString.replace(/backend: cassandra/, "backend: sqlite");
    }
    return yaml.safeLoad(confString);
}

const config = {
    hostPort,
    baseURL,
    globalURL,
    bucketURL,
    apiURL: 'https://en.wikipedia.org/w/api.php',
    makeBucketURL(domain) {
        return `${hostPort}/${domain}/v1/page`;
    },
    secureURL,
    secureBucketURL,
    secureApiURL: 'https://fr.wikipedia.org/w/api.php',
    labsURL,
    labsBucketURL,
    variantsWikiBucketURL,
    labsApiURL: 'https://en.wikipedia.beta.wmflabs.org/w/api.php',
    logStream: logStream(),
    conf: loadConfig(process.env.RB_TEST_CONFIG ? process.env.RB_TEST_CONFIG : `${__dirname}/../../config.test.yaml`),
    parsoidURI
};

config.conf.num_workers = 0;
config.conf.logging = {
    name: 'restbase-tests',
    level: 'trace',
    stream: config.logStream
};

let stop    = function() {};
let isRunning;
let options = null;
const runner = new ServiceRunner();

function start(_options) {
    _options = _options || {};

    if (!assert.isDeepEqual(options, _options) || !isRunning) {
        console.log('server options changed; restarting');
        stop();
        options = _options;
        console.log(`starting restbase in ${
            options.offline ? 'OFFLINE' : 'ONLINE'} mode`);
        config.conf.offline = options.offline || false;

        return runner.run(config.conf)
        .then((servers) => {
            const server = servers[0];
            isRunning = true;
            stop =
                function() {
                    console.log('stopping restbase');
                    isRunning = false;
                    server.close();
                    stop = function() {};
                };
            return true;
        });
    } else {
        return P.resolve();
    }
}

module.exports.config = config;
module.exports.start  = start;
module.exports.stop   = function() { stop(); };
module.exports.loadConfig = loadConfig;
