'use strict';

const P = require('bluebird');
const TestRunner = require('service-runner/test/TestServer');
const DEFAULT_DOMAIN = 'en.wikipedia.beta.wmflabs.org';

class TestRestbase {
    constructor() {
        const testMode = process.env.TEST_MODE || 'fs';
        switch (testMode) {
            case 'fs':
                this._frontendServer = new TestRunner(`${__dirname}/../../config.fullstack.test.yaml`);
                this._backendServer = undefined;
                break;
            case 'fefs':
                this._frontendServer = new TestRunner(`${__dirname}/../../config.frontend.test.yaml`);
                this._backendServer = new TestRunner(`${__dirname}/../../config.fullstack.test.yaml`);
                break;
            case 'febe':
                this._frontendServer = new TestRunner(`${__dirname}/../../config.frontend.test.yaml`);
                this._backendServer = new TestRunner(`${__dirname}/../../config.backend.test.yaml`);
                break;
            default:
                throw new Error(`Invalid test mode ${testMode}`);
        }
    }

    get config() {
        if (!this._frontendServer._running) {
            throw new Error('Accessing test service config before starting the service');
        }
        const conf = this._frontendServer._runner._impl.config;
        const backendConf = this._backendServer ? this._backendServer._runner._impl.config : conf;
        const hostPort = `http://localhost:${conf.services[0].conf.port}`;
        const backendHostPort = `http://localhost:${backendConf.services[0].conf.port}`;
        const baseURL = (domain = DEFAULT_DOMAIN) => `${hostPort}/${domain}/v1`;
        const backendURL = (domain = DEFAULT_DOMAIN) => `${backendHostPort}/${domain}/v1`;
        const bucketURL = (domain) => `${baseURL(domain)}/page`;
        const apiPath = '/w/api.php';
        const apiBase = (domain = DEFAULT_DOMAIN) => `https://${domain}`;
        const apiURL = (domain) => `${apiBase(domain)}${apiPath}`;
        return {
            defaultDomain: DEFAULT_DOMAIN,
            hostPort,
            baseURL,
            backendURL,
            bucketURL,
            apiBase,
            apiPath,
            apiURL,
            parsoidURI: 'http://parsoid-external-ci-access.beta.wmflabs.org/w/rest.php',
            conf
        }
    }

    start() {
        const startPromise = this._backendServer ? this._backendServer.start() : P.resolve();
        return startPromise.then(() => this._frontendServer.start());
    }

    stop() {
        const stopPromise = this._backendServer ? this._backendServer.stop() : P.resolve();
        return stopPromise.then(() => this._frontendServer.stop());
    }
}

module.exports = TestRestbase;
