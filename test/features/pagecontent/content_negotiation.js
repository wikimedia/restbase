'use strict';

const assert = require('../../utils/assert.js');
const preq = require('preq');
const server = require('../../utils/server.js');
const nock = require('nock');

const PARSOID_VERSION_BEFORE_DOWNGRADE = '1.7.0';
const PARSOID_VERSION_BEFORE_DOWNGRADE_PAGE = 'User%3APchelolo%2FContent_Negotiation_Test';
const PARSOID_SUPPORTED_DOWNGRADE = '1.8.0';

describe('Content negotiation', function() {

    this.timeout(20000);

    let currentParsoidContentType;
    let parsoidNock;
    before(() => {
        if (!nock.isActive()) {
            nock.activate();
        }
        return server.start()
        .then(() => preq.get({uri: `${server.config.parsoidURI}/en.wikipedia.org/v3/page/pagebundle/User%3aPchelolo%2fContent_Negotiation_Test`}))
        .then((res) => {
            currentParsoidContentType = res.body.html.headers['content-type'];
            res.body.html.headers['content-type'] = res.body.html.headers['content-type']
            .replace(/\d+\.\d+\.\d+"$/, `${PARSOID_VERSION_BEFORE_DOWNGRADE}"`);
            parsoidNock = nock(server.config.parsoidURI)
            // Content-Location is absolute but for nock we need to transform it to relative.
            .get(res.headers['content-location'].replace(server.config.parsoidURI, ''))
            .reply(200, res.body, res.headers);
        })
        // Just request it to store pre-supported-downgrade version
        .then(() => preq.get({uri: `${server.config.bucketURL}/html/${PARSOID_VERSION_BEFORE_DOWNGRADE_PAGE}`}))
        .then(() => parsoidNock.done())
        .finally(() => {
            nock.cleanAll();
            nock.restore();
        })
    });

    const assertCorrectResponse = (expectedContentType) => (res) => {
        assert.deepEqual(res.status, 200);
        assert.deepEqual(res.headers['content-type'], expectedContentType);
        assert.varyContains(res, 'accept');
        assert.varyNotContains(res, 'accept-language');
        assert.deepEqual(res.headers['cache-control'], 'test_purged_cache_control');
        assert.checkString(res.headers.etag, /^"\d+\/[a-f0-9-]+"$/);
    };

    it('should request html with no accept', () => {
        return preq.get({
            uri: `${server.config.labsBucketURL}/html/Main_Page`
        })
        .then(assertCorrectResponse(currentParsoidContentType));
    });

    it('should not crash on malformed accept header', () => {
        return preq.get({
            uri: `${server.config.labsBucketURL}/html/Main_Page`,
            headers: {
                accept: 'this is a malformed accept header'
            }
        })
        .then(assertCorrectResponse(currentParsoidContentType));
    });

    it('should ignore non-matching content type', () => {
        const wrongContentTypeAccept = currentParsoidContentType
            .replace(/text\/html/, 'application/json')
            .replace(/\d+\.\d+\.\d+"$/, `${PARSOID_SUPPORTED_DOWNGRADE}"`);
        return preq.get({
            uri: `${server.config.labsBucketURL}/html/Main_Page`,
            headers: {
                accept: wrongContentTypeAccept
            }
        })
        .then(assertCorrectResponse(currentParsoidContentType));
    });


    it('should request html with current content type', () => {
        return preq.get({
            uri: `${server.config.labsBucketURL}/html/Main_Page`,
            headers: {
                accept: currentParsoidContentType
            }
        })
        .then(assertCorrectResponse(currentParsoidContentType));
    });

    it('should ignore the higher patch version in accept', () => {
       const bumpPatchAccept = currentParsoidContentType.replace(/\d+"$/, '999"');
        return preq.get({
            uri: `${server.config.labsBucketURL}/html/Main_Page`,
            headers: {
                accept: bumpPatchAccept
            }
        })
        .then(assertCorrectResponse(currentParsoidContentType));
    });

    it('should throw on higher minor version in accept', () => {
        const bumpMinorAccept = currentParsoidContentType.replace(/\d+\.\d+"$/, '999.0"');
        return preq.get({
            uri: `${server.config.labsBucketURL}/html/Main_Page`,
            headers: {
                accept: bumpMinorAccept
            }
        })
        .then(() => {
            throw new Error('406 error should have been thrown');
        }, (e) => {
            assert.deepEqual(e.status, 406);
        });
    });

    it('should throw on higher major version in accept', () => {
        const bumpMinorAccept = currentParsoidContentType.replace(/\d+\.\d+\.\d+"$/, '999.0.0"');
        return preq.get({
            uri: `${server.config.labsBucketURL}/html/Main_Page`,
            headers: {
                accept: bumpMinorAccept
            }
        })
        .then(() => {
            throw new Error('406 error should have been thrown');
        }, (e) => {
            assert.deepEqual(e.status, 406);
        });
    });

    it('should downgrade to exact supported downgrade version', () => {
        const supportedDowngradeContentType = currentParsoidContentType
            .replace(/\d+\.\d+\.\d+"$/, `${PARSOID_SUPPORTED_DOWNGRADE}"`);
        return preq.get({
            uri: `${server.config.labsBucketURL}/html/Main_Page`,
            headers: {
                accept: supportedDowngradeContentType
            }
        })
        .then(assertCorrectResponse(supportedDowngradeContentType));
    });

    it('should downgrade to exact supported downgrade version, lower minor version', () => {
        const supportedMinorVersion = parseInt(/\d+\.(\d+)\.\d+$/.exec(PARSOID_SUPPORTED_DOWNGRADE)[1], 10);
        const lowerMinorDowngradeVersion = PARSOID_SUPPORTED_DOWNGRADE
        .replace(/(\d+\.)\d+(.\d+$)/, `$1${supportedMinorVersion - 1}$2`);
        const supportedDowngradeContentType = currentParsoidContentType
        .replace(/\d+\.\d+\.\d+"$/, `${PARSOID_SUPPORTED_DOWNGRADE}"`);
        const lowerDowngradeContentType = currentParsoidContentType
        .replace(/\d+\.\d+\.\d+"$/, `${lowerMinorDowngradeVersion}"`);
        return preq.get({
            uri: `${server.config.labsBucketURL}/html/Main_Page`,
            headers: {
                accept: lowerDowngradeContentType
            }
        })
        .then(assertCorrectResponse(supportedDowngradeContentType));
    });

    it('should downgrade to exact supported downgrade version, lower minor version, higher patch version', () => {
        const supportedMinorVersion = parseInt(/\d+\.(\d+)\.\d+$/.exec(PARSOID_SUPPORTED_DOWNGRADE)[1], 10);
        const lowerMinorDowngradeVersion = PARSOID_SUPPORTED_DOWNGRADE
        .replace(/(\d+\.)\d+(.\d+$)/, `$1${supportedMinorVersion - 1}.999`);
        const supportedDowngradeContentType = currentParsoidContentType
        .replace(/\d+\.\d+\.\d+"$/, `${PARSOID_SUPPORTED_DOWNGRADE}"`);
        const lowerDowngradeContentType = currentParsoidContentType
        .replace(/\d+\.\d+\.\d+"$/, `${lowerMinorDowngradeVersion}"`);
        return preq.get({
            uri: `${server.config.labsBucketURL}/html/Main_Page`,
            headers: {
                accept: lowerDowngradeContentType
            }
        })
        .then(assertCorrectResponse(supportedDowngradeContentType));
    });

    it('should through 406 on non-satisfiable major version', () => {
        const supportedMinorVersion = parseInt(/\d+\.(\d+)\.\d+$/.exec(PARSOID_SUPPORTED_DOWNGRADE)[1], 10);
        const higherMinorDowngradeVersion = PARSOID_SUPPORTED_DOWNGRADE
        .replace(/(\d+\.)\d+(.\d+$)/, `$1${supportedMinorVersion + 1}$2`);
        const higherDowngradeContentType = currentParsoidContentType
        .replace(/\d+\.\d+\.\d+"$/, `${higherMinorDowngradeVersion}"`);
        return preq.get({
            uri: `${server.config.labsBucketURL}/html/Main_Page`,
            headers: {
                accept: higherDowngradeContentType
            }
        })
        .then(() => {
            throw new Error('406 error should have been thrown');
        }, (e) => {
            assert.deepEqual(e.status, 406);
        });
    });

    it('should return stored if it satisfied ^ of requested', () => {
        const beforeDowngradeMinor = /\d\.(\d)\.\d/.exec(PARSOID_VERSION_BEFORE_DOWNGRADE)[1];
        const evenOlderMinorVersion = PARSOID_VERSION_BEFORE_DOWNGRADE
        .replace(beforeDowngradeMinor, parseInt(beforeDowngradeMinor, 10) - 1);
        const evenOlderParsoidContentType = currentParsoidContentType
        .replace(/\d+\.\d+\.\d+"$/, `${evenOlderMinorVersion}"`);
        const beforeDowngradeContentType = currentParsoidContentType
        .replace(/\d+\.\d+\.\d+"$/, `${PARSOID_VERSION_BEFORE_DOWNGRADE}"`);
        return preq.get({
            uri: `${server.config.bucketURL}/html/${PARSOID_VERSION_BEFORE_DOWNGRADE_PAGE}`,
            headers: {
                accept: evenOlderParsoidContentType
            }
        })
        .then(assertCorrectResponse(beforeDowngradeContentType));
    });

    it('should downgrade after upgrading major version', () => {
        const supportedDowngradeContentType = currentParsoidContentType
        .replace(/\d+\.\d+\.\d+"$/, `${PARSOID_SUPPORTED_DOWNGRADE}"`);
        return preq.get({
            uri: `${server.config.bucketURL}/html/${PARSOID_VERSION_BEFORE_DOWNGRADE_PAGE}`,
            headers: {
                accept: supportedDowngradeContentType
            }
        })
        .then(assertCorrectResponse(supportedDowngradeContentType));
    });
});
