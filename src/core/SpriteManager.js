// src/core/SpriteManager.js - Centralized sprite management

import CreatureFactory from '../entities/creatures/CreatureFactory.js';

class SpriteManager {
  constructor() {
    this.sprites = new Map();
    this.loaded = false;
    this.registeredSprites = []; // Track registered sprite names
  }

  // Get base path from config
  getBasePath() {
    return window.GameConfig ? window.GameConfig.sprites.basePath : 'assets/sprites/';
  }

  // Get sprite files from config
  getSpriteFiles() {
    // Wait a moment and retry if GameConfig isn't available yet
    if (!window.GameConfig) {
      console.warn('GameConfig not yet available, using minimal fallback');
      return {
        'dragon-sprite': 'dragon-sprite.png',
        'skeleton-sprite': 'skeleton-sprite.png'
      };
    }
    
    const files = window.GameConfig.sprites.files;
    return files;
  }

  // Register a sprite for loading
  addSprite(name, filename) {
    const fullPath = this.getBasePath() + filename;
    
    // Test if the file exists by attempting to create an image
    const testImg = new Image();
    testImg.onload = () => {
      // File exists, sprite will load properly
    };
    testImg.onerror = () => {
      console.error(`✗ File NOT found: ${fullPath}`);
    };
    testImg.src = fullPath;
    
    // Add the sprite to PIXI.Assets
    PIXI.Assets.add(name, fullPath);
    
    this.registeredSprites.push(name); // Track registered sprites
  }

  // Load all registered sprites
  async loadSprites() {
    try {
      // Track successful and failed loads
      const successfulLoads = [];
      const failedLoads = [];
      
      // Load each registered sprite individually for better error handling
      for (const spriteName of this.registeredSprites) {
        try {
          const texture = await PIXI.Assets.load(spriteName);
          
          if (texture && texture.width && texture.height) {
            successfulLoads.push(spriteName);
            
            // Store reference for quick verification
            this.sprites.set(spriteName, texture);
          } else {
            console.error(`✗ Invalid texture for ${spriteName}:`, texture);
            failedLoads.push(spriteName);
          }
        } catch (spriteError) {
          console.error(`✗ Failed to load sprite ${spriteName}:`, spriteError);
          failedLoads.push(spriteName);
        }
      }
      
      console.log(`Sprite loading complete: ${successfulLoads.length} successful, ${failedLoads.length} failed`);
      console.log('Successfully loaded:', successfulLoads);
      if (failedLoads.length > 0) {
        console.warn('Failed to load:', failedLoads);
      }
      
      this.loaded = true;
      return true;
    } catch (error) {
      console.error('Error loading sprites:', error);
      this.loaded = true; // Still set to true to allow fallback graphics
      return false;
    }
  }

  // Get a loaded sprite texture
  getSprite(name) {
    if (!this.loaded) {
      console.warn('Sprites not yet loaded');
      return null;
    }
    
    // First try our stored reference
    if (this.sprites.has(name)) {
      return this.sprites.get(name);
    }
    
    // Fallback to PIXI.Assets
    try {
      const sprite = PIXI.Assets.get(name);
      if (sprite) {
        // Store for future reference
        this.sprites.set(name, sprite);
      } else {
        console.error(`✗ Sprite ${name} not found in PIXI.Assets`);
      }
      return sprite;
    } catch (error) {
      console.error(`Error retrieving sprite ${name}:`, error);
      return null;
    }
  }

  // Check if sprites are loaded
  isLoaded() {
    return this.loaded;
  }

  // Check if a specific sprite is available
  hasSpriteLoaded(name) {
    return this.sprites.has(name) || !!PIXI.Assets.get(name);
  }

  /**
   * Register all game sprites from GameConfig
   * Falls back to minimal sprite set if GameConfig not available
   */
  registerGameSprites() {
    // Ensure GameConfig is available
    if (!window.GameConfig) {
      console.error('❌ GameConfig not available! Cannot register all sprites.');
      
      // Register minimal sprites as fallback
      this.addSprite('dragon-sprite', 'dragon-sprite.png');
      this.addSprite('skeleton-sprite', 'skeleton-sprite.png');
      return;
    }
    
    const spriteFiles = this.getSpriteFiles();
    
    // Register all sprites from config
    for (const [spriteName, filename] of Object.entries(spriteFiles)) {
      this.addSprite(spriteName, filename);
    }
  }

  /**
   * Initialize the sprite manager - registers and loads all sprites
   * @returns {Promise<boolean>} Success status of sprite loading
   */
  async initialize() {
    this.registerGameSprites();
    return await this.loadSprites();
  }

}

// Create global sprite manager instance
window.spriteManager = new SpriteManager();

export default SpriteManager;
