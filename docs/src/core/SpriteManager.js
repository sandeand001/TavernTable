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
    // Initialization promise for consumers that need to await readiness
    this._initPromise = null;
  }

  /**
   * Get base path for sprite assets
   * @returns {string} Base path for sprites
   */
  getBasePath() {
    // Always use assets/sprites/ relative to the site root for GitHub Pages
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

    try {
      PIXI.Assets.add(name, fullPath);
      this.registeredSprites.push(name);
      logger.log(LOG_LEVEL.DEBUG, 'Registered sprite', LOG_CATEGORY.ASSETS, {
        context: 'SpriteManager.addSprite',
        name,
        path: fullPath,
      });
    } catch (e) {
      new ErrorHandler().handle(e, ERROR_SEVERITY.LOW, ERROR_CATEGORY.RENDERING, {
        context: 'SpriteManager.addSprite',
        name,
        path: fullPath,
      });
    }
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
            logger.log(LOG_LEVEL.ERROR, 'Invalid texture', LOG_CATEGORY.ASSETS, {
              context: 'SpriteManager.loadSprites',
              spriteName,
              textureInfo: texture ? { width: texture.width, height: texture.height } : null,
            });
            failedLoads.push(spriteName);
          }
        } catch (spriteError) {
          logger.log(LOG_LEVEL.ERROR, 'Failed to load sprite', LOG_CATEGORY.ASSETS, {
            context: 'SpriteManager.loadSprites',
            spriteName,
            error: spriteError?.message || String(spriteError),
          });
          failedLoads.push(spriteName);
        }
      }

      if (failedLoads.length > 0) {
        logger.log(LOG_LEVEL.WARN, 'Some sprites failed to load', LOG_CATEGORY.ASSETS, {
          context: 'SpriteManager.loadSprites',
          failed: failedLoads,
        });
      }

      this.loaded = true;
      return true;
    } catch (error) {
      logger.log(LOG_LEVEL.ERROR, 'Error loading sprites', LOG_CATEGORY.ASSETS, {
        context: 'SpriteManager.loadSprites',
        error: error?.message || String(error),
      });
      this.loaded = true; // Still set to true to allow fallback graphics
      return false;
    }
  }

  // Get a loaded sprite texture
  getSprite(name) {
    if (!this.loaded) {
      logger.log(LOG_LEVEL.WARN, 'Sprites not yet loaded', LOG_CATEGORY.ASSETS, {
        context: 'SpriteManager.getSprite',
        name,
      });
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
        logger.log(LOG_LEVEL.ERROR, 'Sprite not found in PIXI.Assets', LOG_CATEGORY.ASSETS, {
          context: 'SpriteManager.getSprite',
          name,
        });
      }
      return sprite;
    } catch (error) {
      logger.log(LOG_LEVEL.ERROR, 'Error retrieving sprite', LOG_CATEGORY.ASSETS, {
        context: 'SpriteManager.getSprite',
        name,
        error: error?.message || String(error),
      });
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
        configAvailable: !!spriteFiles,
      });

      // Register minimal sprites as fallback
      logger.log(LOG_LEVEL.WARN, 'Using fallback sprite registration', LOG_CATEGORY.SYSTEM, {
        context: 'SpriteManager.registerSprites',
        fallbackSprites: ['dragon-sprite', 'skeleton-sprite'],
        originalError: error.message,
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
    if (this._initPromise) {
      return this._initPromise;
    }
    this._initPromise = (async () => {
      try {
        this.registerGameSprites();
        const ok = await this.loadSprites();
        return ok;
      } catch (e) {
        return false;
      }
    })();
    return this._initPromise;
  }

  /**
   * Create a PIXI.Sprite from a loaded texture name. If not loaded, returns a placeholder Graphics.
   * Does not add to stage; caller owns the display object.
   * @param {string} name Sprite asset name (e.g., 'dragon-sprite')
   * @param {{anchor?: number|{x:number,y:number}, scale?: number}} [options]
   * @returns {PIXI.DisplayObject} PIXI.Sprite if texture exists, otherwise PIXI.Graphics placeholder
   */
  createSprite(name, options = {}) {
    const { anchor = 0.5, scale = 1 } = options;

    const texture = this.getSprite(name);
    if (texture) {
      const sprite = new PIXI.Sprite(texture);
      if (typeof anchor === 'number') {
        sprite.anchor.set(anchor);
      } else if (anchor && typeof anchor === 'object') {
        sprite.anchor.set(anchor.x ?? 0.5, anchor.y ?? 0.5);
      }
      sprite.scale.set(scale);
      return sprite;
    }

    // Fallback placeholder
    const g = new PIXI.Graphics();
    g.beginFill(0xaa0000, 0.6);
    g.lineStyle(2, 0xffffff, 0.9);
    g.drawRoundedRect(-16, -16, 32, 32, 6);
    g.endFill();
    g.scale.set(scale);
    return g;
  }

  /**
   * Convenience: get a scaled PIXI.Sprite for a creature type defined in CREATURE_SCALES
   * @param {string} creatureType e.g., 'dragon', 'skeleton'
   * @returns {PIXI.DisplayObject}
   */
  getCreatureSprite(creatureType) {
    const name = `${creatureType}-sprite`;
    const scale = CREATURE_SCALES?.[creatureType] ?? 1;
    return this.createSprite(name, { scale });
  }

  // Note: We intentionally do not cache PIXI.Sprite instances because
  // display objects cannot be added to multiple parents. Textures are cached.
}

// Create global sprite manager instance
const spriteManager = new SpriteManager();
window.spriteManager = spriteManager;

// ES6 module export
export default SpriteManager;
export { spriteManager };
