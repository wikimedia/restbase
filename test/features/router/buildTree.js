'use strict';

const assert = require('assert');
const preq   = require('preq');
const Router = require('hyperswitch/lib/router');
const server = require('../../utils/server');
const parallel = require('mocha.parallel');

const rootSpec = {
    paths: {
        '/{domain:en.wikipedia.org}/{api:v1}/page': {
            'x-modules': [
                {
                    path: 'v1/content.yaml'
                }
            ]
        }
    }
};

const fullSpec = server.loadConfig('config.example.wikimedia.yaml', true);
const fakeHyperSwitch = { config: {} };

parallel('tree building', () => {

    before(() => { server.start(); });

    it('should build a simple spec tree', () => {
        const router = new Router({
            appBasePath: `${__dirname}/../../..`
        });
        return router.loadSpec(rootSpec, fakeHyperSwitch)
        .then(() => {
            const handler = router.route('/en.wikipedia.org/v1/page/html/Foo');
            assert.equal(!!handler.value.methods.get, true);
            assert.equal(handler.params.domain, 'en.wikipedia.org');
            assert.equal(handler.params.title, 'Foo');
        });
    });

    it('should build the example config spec tree', () => {
        const router = new Router({
            appBasePath: `${__dirname}/../../..`,
            logger: { log: () => {} }
        });
        const resourceRequests = [];
        return router.loadSpec(fullSpec.spec_root, {
            request(req) {
                resourceRequests.push(req);
            },
            config: {},
        })
        .then(() => {
            const handler = router.route('/en.wikipedia.org/v1/page/html/Foo');
            assert.equal(resourceRequests.length > 0, true);
            assert.equal(!!handler.value.methods.get, true);
            assert.equal(handler.params.domain, 'en.wikipedia.org');
            assert.equal(handler.params.title, 'Foo');
        });
    });

    it('should not load root-spec params', () => {
        return preq.get({
            uri: `${server.config.baseURL}/?spec`
        })
        .then((res) => {
            assert.equal(res.body.paths[''], undefined);
        });
    });
});
