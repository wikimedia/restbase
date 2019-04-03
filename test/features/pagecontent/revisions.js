'use strict';

const assert = require('../../utils/assert.js');
const preq   = require('preq');
const Server = require('../../utils/server.js');

function generateTests(server, options) {
    it('should return valid revision info', () => {
        return preq.get({ uri: `${server.config.bucketURL(options.domain)}/title/${encodeURIComponent(options.pageName)}` })
        .then((res) => {
            assert.deepEqual(res.status, 200);
            assert.deepEqual(res.body.items.length, 1);
            assert.deepEqual(res.body.items[0].rev, options.pageLastRev);
            assert.deepEqual(res.body.items[0].title, options.pageName);
            assert.deepEqual(res.body.items[0].redirect, false);
        });
    });

    it('should return redirect true when included', () => {
        return preq.get({
            uri: `${server.config.bucketURL(options.domain)}/title/${encodeURIComponent(options.redirectPageName)}/${options.revRedirect}`
        })
        .then((res) => {
            assert.deepEqual(res.status, 200);
            assert.deepEqual(res.body.items.length, 1);
            assert.deepEqual(res.body.items[0].rev, options.revRedirect);
            assert.deepEqual(res.body.items[0].redirect, true);
        });
    });

    it('should query the MW API for revision info', () => {
        assert.recordRequests();
        return preq.get({
            uri: `${server.config.bucketURL(options.domain)}/title/${encodeURIComponent(options.pageName)}/${options.revPrevious}`,
            headers: { 'cache-control': 'no-cache' }
        })
        .then((res) => {
            assert.deepEqual(res.status, 200);
            assert.deepEqual(res.body.items.length, 1);
            assert.deepEqual(res.body.items[0].rev, options.revPrevious);
            assert.deepEqual(res.body.items[0].title, options.pageName);
            assert.remoteRequests(true);
        })
        .finally(() => assert.cleanupRecorder());
    });

    it('should fail for an invalid revision', () => {
        return preq.get({ uri: `${server.config.bucketURL(options.domain)}/title/${encodeURIComponent(options.pageName)}/faultyrevid` })
        .then((res) => {
            throw new Error(`Expected status 400 for an invalid revision, got ${res.status}`);
        },
        (res) => {
            assert.deepEqual(res.status, 400);
        });
    });

    it('should query the MW API for a non-existent revision and return a 404', () => {
        assert.recordRequests();
        return preq.get({ uri: `${server.config.bucketURL(options.domain)}/title/${encodeURIComponent(options.pageName)}/0` })
        .then((res) => {
            throw new Error(`Expected status 404 for an invalid revision, got ${res.status}`);
        },
        (res) => {
            assert.deepEqual(res.status, 404);
            assert.remoteRequests(true);
        })
        .finally(() => assert.cleanupRecorder());
    });

    it('should return latest revision for a page', () => {
        return preq.get({
            uri: `${server.config.bucketURL(options.domain)}/title/${encodeURIComponent(options.pageName)}`,
            headers: {
                'cache-control': 'no-cache'
            }
        })
        .then((res) => {
            assert.deepEqual(res.status, 200);
            assert.deepEqual(res.body.items.length, 1);
            assert.deepEqual(res.body.items[0].rev, options.pageLastRev);
        });
    });

}

describe('revision requests with en.wikipedia.org', function() {
    this.timeout(20000);
    const server = new Server();
    before(() =>  server.start());
    after(() =>  server.stop());

    const titleDeleted = 'User_talk:DivineAlpha/Q1_2015_discussions';
    const revDeleted = 645504917;

    generateTests(server,{
        domain: 'en.wikipedia.org',
        redirectPageName: 'Main_page',
        revRedirect: 591082967,
        pageName: 'User:GWicke/Date',
        pageLastRev: 653530930,
        revPrevious: 653529842
    });

    it('should fail for a restricted revision fetched from MW API', () => {
        return preq.get({
            uri: `${server.config.bucketURL()}/title/${encodeURIComponent(titleDeleted)}/${revDeleted}`,
            headers: { 'cache-control': 'no-cache' }
        })
        .then((res) => {
            throw new Error(`Expected status 403 for a restricted revision, got ${res.status}`);
        }, res => assert.deepEqual(res.status, 403));
    });

    it('should fail for a restricted revision present in storage', () => {
        return preq.get({
            uri: `${server.config.bucketURL()}/title/${encodeURIComponent(titleDeleted)}/${revDeleted}`,
        })
        .then((res) => {
            throw new Error(`Expected status 403 for a restricted revision, got ${res.status}`);
        }, res => assert.deepEqual(res.status, 403));
    });

    it('should restrict user and comment', () => {
        return preq.get({
            uri: `${server.config.bucketURL()}/title/User:Pchelolo%2fRestricted_Rev`
        })
        .then((res) => {
            assert.deepEqual(res.status, 200);
            const item = res.body.items[0];
            assert.deepEqual(!!item.user_id, false);
            assert.deepEqual(!!item.user_text, false);
            assert.deepEqual(!!item.comment, false);
        });
    });
});

describe('revision requests with test2.wikipedia.org', function() {
    this.timeout(20000);
    const server = new Server();
    before(() =>  server.start());
    after(() =>  server.stop());
    generateTests(server,{
        domain: 'test2.wikipedia.org',
        redirectPageName: 'User:Pchelolo/Redir',
        revRedirect: 157490,
        pageName: 'User:Pchelolo/Date',
        pageLastRev: 329034,
        revPrevious: 157487
    });
});

describe('revision requests with test.wikipedia.org', function() {
    this.timeout(20000);
    const server = new Server();
    before(() =>  server.start());
    after(() =>  server.stop());
    generateTests(server, {
        domain: 'test.wikipedia.org',
        redirectPageName: 'User:Pchelolo/Redir',
        revRedirect: 234965,
        pageName: 'User:Pchelolo/Date',
        pageLastRev: 234964,
        revPrevious: 234963
    });
});

