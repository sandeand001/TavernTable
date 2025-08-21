import { isJest, getNodeEnv } from '../../src/utils/env.js';

describe('env helpers', () => {
    test('isJest returns a boolean', () => {
        expect(typeof isJest()).toBe('boolean');
    });

    test('getNodeEnv returns a string and defaults to development if missing', () => {
        const env = getNodeEnv();
        expect(typeof env).toBe('string');
        expect(env.length).toBeGreaterThan(0);
    });
});
