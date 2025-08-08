// Test for Validation utility functions
// Tests the comprehensive input validation and sanitization system

import { Sanitizers, GameValidators } from '../src/utils/Validation.js';

describe('Validation Utilities', () => {
  describe('Sanitizers', () => {
    describe('integer', () => {
      test('should sanitize valid integer strings', () => {
        expect(Sanitizers.integer('42', 0)).toBe(42);
        expect(Sanitizers.integer('-5', 0)).toBe(-5);
      });

      test('should return default for invalid input', () => {
        expect(Sanitizers.integer('abc', 10)).toBe(10);
        expect(Sanitizers.integer('', 5)).toBe(5);
        expect(Sanitizers.integer(null, 1)).toBe(1);
      });

      test('should respect min/max constraints', () => {
        expect(Sanitizers.integer('100', 50, { min: 0, max: 80 })).toBe(80);
        expect(Sanitizers.integer('-10', 50, { min: 0, max: 100 })).toBe(0);
      });
    });

    describe('float', () => {
      test('should sanitize valid float strings', () => {
        expect(Sanitizers.float('3.14', 0)).toBe(3.14);
        expect(Sanitizers.float('-2.5', 0)).toBe(-2.5);
      });

      test('should return default for invalid input', () => {
        expect(Sanitizers.float('not-a-number', 1.0)).toBe(1.0);
        expect(Sanitizers.float('', 2.5)).toBe(2.5);
      });
    });

    describe('string', () => {
      test('should sanitize strings properly', () => {
        expect(Sanitizers.string('  hello  ', '')).toBe('hello');
        expect(Sanitizers.string('test<script>', '')).toBe('test&lt;script&gt;');
      });

      test('should enforce length limits', () => {
        const result = Sanitizers.string('very long string', '', { maxLength: 5 });
        expect(result).toBe('very ');
      });
    });
  });

  describe('GameValidators', () => {
    describe('coordinates', () => {
      test('should validate valid coordinates', () => {
        const result = GameValidators.coordinates(5, 10);
        expect(result.isValid).toBe(true);
        expect(result.errors).toHaveLength(0);
      });

      test('should reject invalid coordinates', () => {
        const result = GameValidators.coordinates(-1, 5);
        expect(result.isValid).toBe(false);
        expect(result.errors.length).toBeGreaterThan(0);
      });

      test('should reject non-numeric coordinates', () => {
        const result = GameValidators.coordinates('abc', 5);
        expect(result.isValid).toBe(false);
      });
    });

    describe('creatureType', () => {
      test('should validate known creature types', () => {
        const result = GameValidators.creatureType('dragon');
        expect(result.isValid).toBe(true);
      });

      test('should reject unknown creature types', () => {
        const result = GameValidators.creatureType('unicorn');
        expect(result.isValid).toBe(false);
      });

      test('should handle special remove type', () => {
        const result = GameValidators.creatureType('remove');
        expect(result.isValid).toBe(true);
      });
    });

    describe('domElement', () => {
      test('should validate proper DOM elements', () => {
        const div = document.createElement('div');
        const result = GameValidators.domElement(div, 'div');
        expect(result.isValid).toBe(true);
      });

      test('should reject null elements', () => {
        const result = GameValidators.domElement(null, 'div');
        expect(result.isValid).toBe(false);
      });

      test('should reject wrong element types', () => {
        const span = document.createElement('span');
        const result = GameValidators.domElement(span, 'div');
        expect(result.isValid).toBe(false);
      });
    });

    describe('pixiApp', () => {
      test('should validate PIXI application structure', () => {
        const mockApp = {
          stage: { addChild: jest.fn() },
          view: new HTMLCanvasElement(),
          screen: { width: 800, height: 600 }
        };
        const result = GameValidators.pixiApp(mockApp);
        expect(result.isValid).toBe(true);
      });

      test('should reject incomplete PIXI applications', () => {
        const result = GameValidators.pixiApp({});
        expect(result.isValid).toBe(false);
      });
    });
  });
});
