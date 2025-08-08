/**
 * GameManager Integration Test
 * Quick test to verify the refactored GameManager works correctly
 */

import GameManager from '../src/core/GameManager.js';

// Mock PIXI for testing
global.PIXI = {
  Application: class MockApplication {
    constructor(options) {
      this.screen = { width: 800, height: 600 };
      this.stage = { 
        interactive: false, 
        interactiveChildren: true,
        addChild: () => {},
        removeChild: () => {}
      };
      this.canvas = document.createElement('canvas');
      this.view = this.canvas;
      this.ticker = { speed: 1 };
    }
    
    start() {}
    stop() {}
    destroy() {}
  },
  Container: class MockContainer {
    constructor() {
      this.x = 0;
      this.y = 0;
      this.children = [];
    }
    
    addChild() {}
    removeChild() {}
  },
  Graphics: class MockGraphics {
    constructor() {
      this.x = 0;
      this.y = 0;
    }
    
    clear() { return this; }
    beginFill() { return this; }
    drawRect() { return this; }
    endFill() { return this; }
  }
};

// Test the refactored GameManager
describe('Refactored GameManager Integration', () => {
  let gameManager;
  
  beforeEach(() => {
    // Create a mock game container
    const mockContainer = document.createElement('div');
    mockContainer.id = 'game-container';
    document.body.appendChild(mockContainer);
    
    gameManager = new GameManager();
  });
  
  afterEach(() => {
    // Clean up
    const container = document.getElementById('game-container');
    if (container) {
      container.remove();
    }
  });
  
  test('GameManager should be created with coordinators', () => {
    expect(gameManager).toBeDefined();
    expect(gameManager.renderCoordinator).toBeDefined();
    expect(gameManager.stateCoordinator).toBeDefined();
    expect(gameManager.inputCoordinator).toBeDefined();
  });
  
  test('GameManager should have default properties', () => {
    expect(gameManager.tileWidth).toBe(64);
    expect(gameManager.tileHeight).toBe(32);
    expect(gameManager.cols).toBe(25);
    expect(gameManager.rows).toBe(25);
  });
  
  test('GameManager should have delegated methods', () => {
    expect(typeof gameManager.createPixiApp).toBe('function');
    expect(typeof gameManager.centerGrid).toBe('function');
    expect(typeof gameManager.resetZoom).toBe('function');
    expect(typeof gameManager.handleLeftClick).toBe('function');
    expect(typeof gameManager.resizeGrid).toBe('function');
  });
  
  test('GameManager should handle backward compatibility properties', () => {
    // Test getter/setter delegation
    expect(gameManager.selectedTokenType).toBe('goblin'); // default fallback
    expect(gameManager.tokenFacingRight).toBe(true); // default fallback
    expect(Array.isArray(gameManager.placedTokens)).toBe(true);
  });
  
  test('GameManager resizeGrid should sanitize inputs', () => {
    expect(() => {
      gameManager.resizeGrid(10, 8);
    }).not.toThrow();
    
    expect(gameManager.cols).toBe(10);
    expect(gameManager.rows).toBe(8);
  });
  
  test('GameManager should handle invalid resize inputs', () => {
    expect(() => {
      gameManager.resizeGrid(-5, 100); // Should clamp to valid range
    }).not.toThrow();
    
    // Should be clamped to minimum/maximum values
    expect(gameManager.cols).toBeGreaterThanOrEqual(5);
    expect(gameManager.rows).toBeLessThanOrEqual(50);
  });
});

console.log('GameManager integration test completed');
