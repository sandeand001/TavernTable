// Test for CoordinateUtils utility functions
// Tests coordinate conversion and validation for isometric grid system

import { CoordinateUtils } from '../src/utils/CoordinateUtils.js';

describe('CoordinateUtils', () => {
  const tileWidth = 64;
  const tileHeight = 32;

  describe('gridToIsometric', () => {
    test('should convert grid coordinates to isometric', () => {
      const result = CoordinateUtils.gridToIsometric(2, 3, tileWidth, tileHeight);
      expect(result.x).toBe(-32); // (2-3) * (64/2)
      expect(result.y).toBe(80);  // (2+3) * (32/2)
    });

    test('should handle origin correctly', () => {
      const result = CoordinateUtils.gridToIsometric(0, 0, tileWidth, tileHeight);
      expect(result.x).toBe(0);
      expect(result.y).toBe(0);
    });

    test('should handle negative coordinates', () => {
      const result = CoordinateUtils.gridToIsometric(-1, 2, tileWidth, tileHeight);
      expect(result.x).toBe(-96); // (-1-2) * (64/2)
      expect(result.y).toBe(16);  // (-1+2) * (32/2)
    });
  });

  describe('isometricToGrid', () => {
    test('should convert isometric coordinates to grid', () => {
      const result = CoordinateUtils.isometricToGrid(-32, 80, tileWidth, tileHeight);
      expect(result.x).toBe(2);
      expect(result.y).toBe(3);
    });

    test('should handle origin correctly', () => {
      const result = CoordinateUtils.isometricToGrid(0, 0, tileWidth, tileHeight);
      expect(result.x).toBe(0);
      expect(result.y).toBe(0);
    });

    test('should round to nearest grid position', () => {
      const result = CoordinateUtils.isometricToGrid(-30, 82, tileWidth, tileHeight);
      // Should round to nearest grid position
      expect(Number.isInteger(result.x)).toBe(true);
      expect(Number.isInteger(result.y)).toBe(true);
    });
  });

  describe('isValidGridPosition', () => {
    test('should validate positions within bounds', () => {
      expect(CoordinateUtils.isValidGridPosition(5, 3, 10, 8)).toBe(true);
      expect(CoordinateUtils.isValidGridPosition(0, 0, 10, 8)).toBe(true);
      expect(CoordinateUtils.isValidGridPosition(9, 7, 10, 8)).toBe(true);
    });

    test('should reject positions outside bounds', () => {
      expect(CoordinateUtils.isValidGridPosition(-1, 3, 10, 8)).toBe(false);
      expect(CoordinateUtils.isValidGridPosition(5, -1, 10, 8)).toBe(false);
      expect(CoordinateUtils.isValidGridPosition(10, 3, 10, 8)).toBe(false);
      expect(CoordinateUtils.isValidGridPosition(5, 8, 10, 8)).toBe(false);
    });

    test('should handle edge cases', () => {
      expect(CoordinateUtils.isValidGridPosition(0.5, 2, 10, 8)).toBe(false);
      expect(CoordinateUtils.isValidGridPosition(2, 3.7, 10, 8)).toBe(false);
    });
  });

  describe('roundtrip conversion', () => {
    test('should maintain consistency in conversions', () => {
      const originalGrid = { x: 4, y: 6 };
      
      // Convert to isometric and back
      const iso = CoordinateUtils.gridToIsometric(originalGrid.x, originalGrid.y, tileWidth, tileHeight);
      const backToGrid = CoordinateUtils.isometricToGrid(iso.x, iso.y, tileWidth, tileHeight);
      
      expect(backToGrid.x).toBe(originalGrid.x);
      expect(backToGrid.y).toBe(originalGrid.y);
    });

    test('should handle multiple coordinate pairs', () => {
      const testCases = [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
        { x: 5, y: 3 },
        { x: 10, y: 8 }
      ];

      testCases.forEach(original => {
        const iso = CoordinateUtils.gridToIsometric(original.x, original.y, tileWidth, tileHeight);
        const converted = CoordinateUtils.isometricToGrid(iso.x, iso.y, tileWidth, tileHeight);
        
        expect(converted.x).toBe(original.x);
        expect(converted.y).toBe(original.y);
      });
    });
  });
});
