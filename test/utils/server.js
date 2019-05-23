'use strict';

const P = require('bluebird');
const TestRunner = require('service-runner/test/TestServer');
const DEFAULT_DOMAIN = 'en.wikipedia.org';

class TestRestbase extends TestRunner {
    constructor(configPath = `${__dirname}/../../config.test.yaml`, forseSkipBackend) {
        super(configPath);
        this._spinBackend = !forseSkipBackend && !!process.env.RB_TEST_BACKEND_HOST_TEMPLATE;
        if (this._spinBackend) {
            this._backendServer = new TestRestbase(
                `${__dirname}/../../config.example.storage.wikimedia.yaml`,
                true);
        }
    }

    get config() {
        if (!this._running) {
            throw new Error('Accessing test service config before starting the service');
        }
        const conf = this._runner._impl.config;
        const hostPort = `http://localhost:${conf.services[0].conf.port}`;
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
            conf
        }
    }

    start() {
        const startPromise = this._spinBackend ? this._backendServer.start() : P.resolve();
        return startPromise.then(() => super.start());
    }

    stop() {
        const stopPromise = this._spinBackend ? this._backendServer.stop() : P.resolve();
        return stopPromise.then(() => super.stop());
    }
}

module.exports = TestRestbase;
