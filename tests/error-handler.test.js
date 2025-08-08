// Test for ErrorHandler functionality
// Tests error categorization, logging, and user notification system

import { GameErrors, ERROR_LEVELS, ERROR_CATEGORIES } from '../src/utils/ErrorHandler.js';

// Mock DOM methods for error display testing
document.getElementById = jest.fn((id) => {
  if (id === 'error-display') {
    return {
      appendChild: jest.fn(),
      removeChild: jest.fn(),
      children: []
    };
  }
  return null;
});

describe('ErrorHandler', () => {
  beforeEach(() => {
    // Clear any previous error state
    jest.clearAllMocks();
    // Reset console mocks
    console.error = jest.fn();
    console.warn = jest.fn();
    console.log = jest.fn();
  });

  describe('Error Categories', () => {
    test('should handle initialization errors', () => {
      const error = new Error('PIXI failed to initialize');
      const context = { stage: 'createPixiApp' };
      
      expect(() => {
        GameErrors.initialization(error, context);
      }).not.toThrow();
      
      expect(console.error).toHaveBeenCalled();
    });

    test('should handle rendering errors', () => {
      const error = new Error('Failed to draw tile');
      const context = { coordinates: { x: 5, y: 3 } };
      
      expect(() => {
        GameErrors.rendering(error, context);
      }).not.toThrow();
      
      expect(console.error).toHaveBeenCalled();
    });

    test('should handle input validation errors', () => {
      const error = new Error('Invalid grid coordinates');
      const context = { gridX: -1, gridY: 5 };
      
      expect(() => {
        GameErrors.input(error, context);
      }).not.toThrow();
      
      expect(console.error).toHaveBeenCalled();
    });

    test('should handle sprite loading errors', () => {
      const error = new Error('Sprite not found');
      const context = { spriteName: 'dragon-sprite.png' };
      
      expect(() => {
        GameErrors.sprites(error, context);
      }).not.toThrow();
      
      expect(console.error).toHaveBeenCalled();
    });

    test('should handle validation errors', () => {
      const error = new Error('Creature type validation failed');
      const context = { creatureType: 'invalid-creature' };
      
      expect(() => {
        GameErrors.validation(error, context);
      }).not.toThrow();
      
      expect(console.error).toHaveBeenCalled();
    });

    test('should handle network errors', () => {
      const error = new Error('Failed to load external resource');
      const context = { url: 'https://example.com/sprite.png' };
      
      expect(() => {
        GameErrors.network(error, context);
      }).not.toThrow();
      
      expect(console.error).toHaveBeenCalled();
    });
  });

  describe('Error Levels', () => {
    test('should have defined error levels', () => {
      expect(ERROR_LEVELS.LOW).toBeDefined();
      expect(ERROR_LEVELS.MEDIUM).toBeDefined();
      expect(ERROR_LEVELS.HIGH).toBeDefined();
      expect(ERROR_LEVELS.CRITICAL).toBeDefined();
    });

    test('should handle critical errors differently', () => {
      const error = new Error('Critical system failure');
      
      expect(() => {
        GameErrors.initialization(error, { severity: ERROR_LEVELS.CRITICAL });
      }).not.toThrow();
      
      // Critical errors should be logged
      expect(console.error).toHaveBeenCalled();
    });
  });

  describe('Error Categories Constants', () => {
    test('should have all required categories', () => {
      expect(ERROR_CATEGORIES.INITIALIZATION).toBeDefined();
      expect(ERROR_CATEGORIES.RENDERING).toBeDefined();
      expect(ERROR_CATEGORIES.INPUT).toBeDefined();
      expect(ERROR_CATEGORIES.SPRITES).toBeDefined();
      expect(ERROR_CATEGORIES.VALIDATION).toBeDefined();
      expect(ERROR_CATEGORIES.NETWORK).toBeDefined();
    });
  });

  describe('Generic Error Handling', () => {
    test('should handle generic errors with handleError method', () => {
      const error = new Error('Generic error');
      const message = 'Something went wrong';
      
      expect(() => {
        GameErrors.handleError(error, message);
      }).not.toThrow();
      
      expect(console.error).toHaveBeenCalled();
    });

    test('should handle errors without context', () => {
      const error = new Error('Simple error');
      
      expect(() => {
        GameErrors.input(error);
      }).not.toThrow();
      
      expect(console.error).toHaveBeenCalled();
    });
  });

  describe('Error Context Preservation', () => {
    test('should preserve error context in logs', () => {
      const error = new Error('Test error');
      const context = {
        stage: 'testing',
        coordinates: { x: 1, y: 2 },
        timestamp: new Date().toISOString()
      };
      
      GameErrors.rendering(error, context);
      
      // Verify console.error was called with proper arguments
      expect(console.error).toHaveBeenCalled();
      const logCall = console.error.mock.calls[0];
      expect(logCall).toBeDefined();
      expect(logCall.length).toBeGreaterThan(0);
    });
  });
});
