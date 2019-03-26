'use strict';

const TestRunner = require('service-runner/test/TestServer');
const DEFAULT_DOMAIN = 'en.wikipedia.org';

class TestRestbase extends TestRunner {
    constructor(configPath = `${__dirname}/../../config.test.yaml`) {
        super(configPath);
    }

    get config() {
        if (!this._running) {
            throw new Error('Accessing test service config before starting the service');
        }
        const hostPort = 'http://localhost:7231';
        const baseURL = (domain = DEFAULT_DOMAIN) => `${hostPort}/${domain}/v1`;
        const bucketURL = (domain) => `${baseURL(domain)}/page`;
        const apiPath = '/w/api.php';
        const apiBase = (domain = DEFAULT_DOMAIN) => `https://${domain}`;
        const apiURL = (domain) => `${apiBase(domain)}${apiPath}`;
        return {
            defaultDomain: DEFAULT_DOMAIN,
            hostPort,
            baseURL,
            bucketURL,
            apiBase,
            apiPath,
            apiURL,
            parsoidURI: 'https://parsoid-beta.wmflabs.org',
            conf: this._runner._impl.config
        }
    }
}

module.exports = TestRestbase;
