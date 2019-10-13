'use strict';

/**
 * Unit tests for Parsoid proxy param handling
 */

const assert = require('../utils/assert');

const proxy = require('../../sys/parsoid.js');

describe('Parsoid proxy param handling', () => {

    it('should fail for invalid variant', () => {
        try {
            proxy({
                host: 'dummy',
                php_host: 'dummy2',
                proxy: {
                    default_variant: 'fake'
                }
            });
        } catch(e) {
            assert.ok(/valid variants/.test(e.message));
            return true;
        }
        throw new Error('Expected an error to be thrown');
    });

    it('should fail for invalid mode', () => {
        try {
            proxy({
                host: 'dummy',
                php_host: 'dummy2',
                proxy: {
                    mode: 'joke'
                }
            });
        } catch(e) {
            assert.ok(/valid modes/.test(e.message));
            return true;
        }
        throw new Error('Expected an error to be thrown');
    });

    it('should fail for invalid percentage', () => {
        try {
            proxy({
                host: 'dummy',
                php_host: 'dummy2',
                proxy: {
                    percentage: 120
                }
            });
        } catch(e) {
            assert.ok(/percentage must/.test(e.message));
        }
        try {
            proxy({
                host: 'dummy',
                php_host: 'dummy2',
                proxy: {
                    percentage: 'abcdef'
                }
            });
        } catch(e) {
            assert.ok(/percentage must/.test(e.message));
            return true;
        }
        throw new Error('Expected an error to be thrown');
    });

    it('should fail for empty php_host', () => {
        try {
            proxy({
                host: 'dummy',
                proxy: {
                    mode: 'mirror',
                    percentage: 30
                }
            });
        } catch(e) {
            assert.ok(/expected both/.test(e.message));
            return true;
        }
        throw new Error('Expected an error to be thrown');
    });

    it('should fail for mirroring', () => {
        try {
            proxy({
                host: 'dummy',
                php_host: 'dummy2',
                proxy: {
                    default_variant: 'php',
                    mode: 'mirror',
                    percentage: 20
                }
            });
        } catch(e) {
            assert.ok(/when mirroring/.test(e.message));
            return true;
        }
        throw new Error('Expected an error to be thrown');
    });

    it('should export only js resources', () => {
        const mod = proxy({
            host: 'dummy',
            proxy: {}
        });
        const r = mod.resources;
        assert.ok(r);
        assert.deepEqual(r.length, 2);
        assert.deepEqual(r[0].uri, '/{domain}/sys/key_value/parsoid');
        assert.deepEqual(r[1].uri, '/{domain}/sys/key_value/parsoid-stash');
    });

    it('should export only php resources', () => {
        const mod = proxy({
            host: 'dummy',
            proxy: {
                default_variant: 'php'
            }
        });
        const r = mod.resources;
        assert.ok(r);
        assert.deepEqual(r.length, 2);
        assert.deepEqual(r[0].uri, '/{domain}/sys/key_value/parsoidphp');
        assert.deepEqual(r[1].uri, '/{domain}/sys/key_value/parsoidphp-stash');
    });

    it('should export both resources', () => {
        const mod = proxy({
            host: 'dummy',
            php_host: 'dummy2',
            proxy: {
                mode: 'mirror'
            }
        });
        const r = mod.resources;
        assert.ok(r);
        assert.deepEqual(r.length, 4);
        assert.deepEqual(r[0].uri, '/{domain}/sys/key_value/parsoid');
        assert.deepEqual(r[1].uri, '/{domain}/sys/key_value/parsoid-stash');
        assert.deepEqual(r[2].uri, '/{domain}/sys/key_value/parsoidphp');
        assert.deepEqual(r[3].uri, '/{domain}/sys/key_value/parsoidphp-stash');
    });

});

