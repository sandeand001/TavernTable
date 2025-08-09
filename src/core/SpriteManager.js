// src/core/SpriteManager.js - Centralized sprite management

/**
 * Sprite Manager
 * 
 * Handles loading, caching, and retrieval of game sprite assets.
 * Provides fallback mechanisms for missing sprites and comprehensive error handling.
 * 
 * @module SpriteManager
 * @author TavernTable
 * @since 1.0.0
 */

import { CREATURE_SCALES } from '../config/GameConstants.js';
import { logger, LOG_LEVEL, LOG_CATEGORY } from '../utils/Logger.js';
import { ErrorHandler, ERROR_SEVERITY, ERROR_CATEGORY } from '../utils/ErrorHandler.js';

/**
 * Centralized sprite management class
 */
class SpriteManager {
  constructor() {
    this.sprites = new Map();
    this.loaded = false;
    this.registeredSprites = []; // Track registered sprite names
  }

  /**
   * Get base path for sprite assets
   * @returns {string} Base path for sprites
   */
  getBasePath() {
    return 'assets/sprites/';
  }

  /**
   * Get sprite files configuration
   * @returns {Object} Sprite file mapping
   */
  getSpriteFiles() {
    // Generate sprite mapping from creature types in GameConstants
    const spriteFiles = {};
    
    // Get all creature types from CREATURE_SCALES
    const creatureTypes = Object.keys(CREATURE_SCALES);
    
    for (const creatureType of creatureTypes) {
      spriteFiles[`${creatureType}-sprite`] = `${creatureType}-sprite.png`;
    }
    
    return spriteFiles;
  }

  /**
   * Register a sprite for loading
   * @param {string} name - Sprite name
   * @param {string} filename - Filename relative to base path
   */
  addSprite(name, filename) {
    const fullPath = this.getBasePath() + filename;
    
    // Test if the file exists by attempting to create an image
    const testImg = new Image();
    testImg.onload = () => {
      // File exists validation passed
    };
    testImg.onerror = () => {
      console.error(`❌ File NOT found: ${fullPath}`);
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
    // First check our internal cache which only contains successfully loaded sprites
    if (this.sprites.has(name)) {
      return true;
    }
    
    // Fallback check PIXI.Assets, but verify it's a valid texture
    try {
      const asset = PIXI.Assets.get(name);
      if (asset && asset.width && asset.height) {
        // Store it in our cache for future reference
        this.sprites.set(name, asset);
        return true;
      }
    } catch (error) {
      // Asset check failed
    }
    
    return false;
  }

  /**
   * Register all game sprites from GameConstants
   * Uses creature types from CREATURE_SCALES to generate sprite list
   */
  registerGameSprites() {
    let spriteFiles = null;
    try {
      spriteFiles = this.getSpriteFiles();
      
      // Register all sprites from config
      for (const [spriteName, filename] of Object.entries(spriteFiles)) {
        this.addSprite(spriteName, filename);
      }
      
    } catch (error) {
      new ErrorHandler().handle(error, ERROR_SEVERITY.MEDIUM, ERROR_CATEGORY.RENDERING, {
        context: 'SpriteManager.registerSprites',
        stage: 'sprite_registration',
        spritesRegistered: this.registeredSprites.length,
        fallbackMode: true,
        configAvailable: !!spriteFiles
      });
      
      // Register minimal sprites as fallback
      logger.log(LOG_LEVEL.WARN, 'Using fallback sprite registration', LOG_CATEGORY.SYSTEM, {
        context: 'SpriteManager.registerSprites',
        fallbackSprites: ['dragon-sprite', 'skeleton-sprite'],
        originalError: error.message
      });
      this.addSprite('dragon-sprite', 'dragon-sprite.png');
      this.addSprite('skeleton-sprite', 'skeleton-sprite.png');
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
const spriteManager = new SpriteManager();
window.spriteManager = spriteManager;

// ES6 module export
export default SpriteManager;
export { spriteManager };
