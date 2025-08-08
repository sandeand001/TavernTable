// Jest setup file for TavernTable test environment
// Provides necessary mocks and global utilities for testing

// Mock browser APIs that PIXI.js and our modules depend on
global.HTMLCanvasElement = class MockCanvas {
  constructor() {
    this.width = 800;
    this.height = 600;
  }
  
  getContext() {
    return {
      fillRect: jest.fn(),
      clearRect: jest.fn(),
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 1,
      drawImage: jest.fn(),
      save: jest.fn(),
      restore: jest.fn(),
      translate: jest.fn(),
      rotate: jest.fn(),
      scale: jest.fn()
    };
  }
  
  toDataURL() {
    return 'data:image/png;base64,mock';
  }
  
  addEventListener() {}
  removeEventListener() {}
};

global.Image = class MockImage {
  constructor() {
    this.onload = null;
    this.onerror = null;
    this.src = '';
    this.width = 100;
    this.height = 100;
  }
};

// Mock PIXI.js for testing
global.PIXI = {
  Application: jest.fn().mockImplementation(() => ({
    stage: {
      addChild: jest.fn(),
      removeChild: jest.fn(),
      interactive: false,
      interactiveChildren: true
    },
    view: new global.HTMLCanvasElement(),
    canvas: new global.HTMLCanvasElement(),
    screen: { width: 800, height: 600 },
    ticker: { speed: 1 },
    animationSpeedMultiplier: 1
  })),
  
  Container: jest.fn().mockImplementation(() => ({
    addChild: jest.fn(),
    removeChild: jest.fn(),
    children: [],
    x: 0,
    y: 0,
    scale: { set: jest.fn() },
    alpha: 1
  })),
  
  Graphics: jest.fn().mockImplementation(() => ({
    lineStyle: jest.fn().mockReturnThis(),
    beginFill: jest.fn().mockReturnThis(),
    moveTo: jest.fn().mockReturnThis(),
    lineTo: jest.fn().mockReturnThis(),
    endFill: jest.fn().mockReturnThis(),
    x: 0,
    y: 0,
    alpha: 1,
    isGridTile: false,
    gridX: 0,
    gridY: 0
  })),
  
  Sprite: jest.fn().mockImplementation(() => ({
    x: 0,
    y: 0,
    width: 50,
    height: 50,
    scale: { set: jest.fn() },
    anchor: { set: jest.fn() },
    interactive: true,
    buttonMode: true,
    on: jest.fn(),
    off: jest.fn(),
    parent: null
  })),
  
  Assets: {
    load: jest.fn().mockResolvedValue({
      width: 64,
      height: 64,
      baseTexture: { valid: true }
    })
  }
};

// Mock window object properties
Object.defineProperty(window, 'devicePixelRatio', {
  writable: true,
  value: 1
});

Object.defineProperty(window, 'innerWidth', {
  writable: true,
  value: 1024
});

Object.defineProperty(window, 'innerHeight', {
  writable: true,
  value: 768
});

// Provide basic console methods for logger
global.console = {
  ...console,
  debug: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
  log: jest.fn()
};

// Mock localStorage
const localStorageMock = {
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
  clear: jest.fn()
};
global.localStorage = localStorageMock;

// Suppress specific warnings in tests
const originalError = console.error;
beforeAll(() => {
  console.error = (...args) => {
    if (
      typeof args[0] === 'string' &&
      args[0].includes('Warning: ReactDOM.render is deprecated')
    ) {
      return;
    }
    originalError.call(console, ...args);
  };
});

afterAll(() => {
  console.error = originalError;
});
