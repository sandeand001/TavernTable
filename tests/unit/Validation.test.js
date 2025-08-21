import { TypeValidators, Sanitizers } from '../../src/utils/Validation.js';

describe('Validation utilities', () => {
  test('TypeValidators.isNumber works on boundary values', () => {
    expect(TypeValidators.isNumber(0)).toBe(true);
    expect(TypeValidators.isNumber(-1)).toBe(true);
    expect(TypeValidators.isNumber(NaN)).toBe(false);
    expect(TypeValidators.isNumber('1')).toBe(false);
  });

  test('Sanitizers.enum falls back to default on invalid value', () => {
    const def = 'a';
    const allowed = ['a', 'b', 'c'];
    expect(Sanitizers.enum('foo', def, allowed)).toBe(def);
    expect(Sanitizers.enum('b', def, allowed)).toBe('b');
  });

  test('Sanitizers.integer applies min/max constraints', () => {
    expect(Sanitizers.integer(10, 0, { max: 5 })).toBe(5);
    expect(Sanitizers.integer(-10, 0, { min: -5 })).toBe(-5);
    expect(Sanitizers.integer(2, 0, { min: -5, max: 5 })).toBe(2);
  });
});
