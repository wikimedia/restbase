'use strict';

const assert = require('../../utils/assert.js');
const preq = require('preq');
const server = require('../../utils/server.js');

const PARSOID_SUPPORTED_DOWNGRADE = '1.8.0';

describe('Content negotiation', function() {

    this.timeout(20000);

    let currentParsoidContentType;
    before(() =>
        server.start()
        .then(() => preq.get({ uri: `${server.config.labsBucketURL}/html/Main_Page`}))
        .then((res) => {
            currentParsoidContentType = res.headers['content-type'];
        })
    );

    const assertCorrectResponse = (expectedContentType) => (res) => {
        assert.deepEqual(res.status, 200);
        assert.deepEqual(res.headers['content-type'], expectedContentType);
        assert.varyContains(res, 'accept');
        assert.varyNotContains(res, 'accept-language');
        assert.deepEqual(res.headers['cache-control'], 'test_purged_cache_control');
        assert.checkString(res.headers.etag, /^"\d+\/[a-f0-9-]+"$/);
    };

    it('should not crash on malformad accept header', () => {
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
                accept: 'this is a malformed accept header'
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
});
