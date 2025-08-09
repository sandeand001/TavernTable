// src/entities/creatures/CreatureToken.js - Base class for all creature tokens

import { CREATURE_SCALES } from '../../config/GameConstants.js';
import { ErrorHandler, ERROR_SEVERITY, ERROR_CATEGORY, GameErrors } from '../../utils/ErrorHandler.js';
import { GameValidators, Sanitizers } from '../../utils/Validation.js';

/**
 * Base class for all creature tokens in the TavernTable game
 * 
 * Provides common functionality for creature sprite creation, positioning,
 * scaling, and interaction management. Supports both sprite-based and 
 * fallback graphics rendering.
 * 
 * @class CreatureToken
 * @version 1.0.0
 */
class CreatureToken {
  /**
   * Create a new creature token
   * @param {string} type - Creature type identifier
   * @param {number} x - Initial X position (default: 0)
   * @param {number} y - Initial Y position (default: 0)
   * @param {boolean} facingRight - Whether creature faces right (default: true)
   */
  constructor(type, x = 0, y = 0, facingRight = true) {
    try {
      // Validate creature type
      const typeValidation = GameValidators.creatureType(type);
      if (!typeValidation.isValid) {
        throw new Error(`Invalid creature type: ${typeValidation.getErrorMessage()}`);
      }
      
      this.type = type;
      this.x = Sanitizers.integer(x, 0);
      this.y = Sanitizers.integer(y, 0);
      this.facingRight = Boolean(facingRight);
      this.sprite = null;
      
      this.createSprite();
    } catch (error) {
      new ErrorHandler().handle(error, ERROR_SEVERITY.HIGH, ERROR_CATEGORY.RENDERING, {
        context: 'CreatureToken.constructor',
        stage: 'token_initialization',
        parameters: { type, x, y, facingRight },
        typeValidation: !!type,
        coordinateValidation: { x: typeof x, y: typeof y }
      });
      throw error;
    }
  }

  /**
   * Create the sprite representation for this creature
   * Attempts sprite loading first, falls back to drawn graphics if needed
   */
  createSprite() {
    try {
      // Try to create sprite from asset first
      this.createCreatureSprite();
      
      // Apply facing direction after sprite creation
      this.applyFacing();
    } catch (error) {
      GameErrors.sprites(error, {
        stage: 'createSprite',
        creatureType: this.type
      });
      // Attempt fallback graphics creation
      this.createFallbackGraphics();
    }
  }

  /**
   * Create creature sprite from loaded assets
   * Falls back to drawn graphics if sprites are not available
   */
  createCreatureSprite() {
    try {
      // Check if sprite manager is ready
      if (!window.spriteManager || !window.spriteManager.isLoaded()) {
        this.createFallbackGraphics();
        return;
      }
      
      const spriteKey = `${this.type}-sprite`;
      
      // Check if this specific sprite is available
      if (!window.spriteManager.hasSpriteLoaded(spriteKey)) {
        this.createFallbackGraphics();
        
        // Try to retry sprite loading after a short delay
        setTimeout(() => {
          if (window.spriteManager.hasSpriteLoaded(spriteKey) && this.sprite && this.sprite.parent) {
            this.replaceWithSprite();
          }
        }, 1000);
        return;
      }
      
      const texture = window.spriteManager.getSprite(spriteKey);
      if (!texture) {
        this.createFallbackGraphics();
        return;
      }
      
      // Create sprite with texture
      this.sprite = new PIXI.Sprite(texture);
      this.sprite.anchor.set(0.5, 0.5);
      
      // Set scale based on creature type
      const scale = this.getCreatureScale();
      this.sprite.scale.set(scale, scale);
      
    } catch (error) {
      GameErrors.sprites(error, {
        stage: 'createCreatureSprite',
        creatureType: this.type
      });
      this.createFallbackGraphics();
    }
  }

  /**
   * Get the appropriate scale for this creature type
   * Uses configuration constants with fallback to legacy values
   * @returns {number} Scale value for the creature sprite
   */
  getCreatureScale() {
    try {
      // Primary: Use configuration constants
      if (CREATURE_SCALES[this.type]) {
        return CREATURE_SCALES[this.type];
      }
      
      // Fallback: Default scale for unknown creatures
      console.warn(`No scale defined for creature type: ${this.type}, using default`);
      return CREATURE_SCALES.goblin || 0.06;
    } catch (error) {
      GameErrors.validation(error, {
        stage: 'getCreatureScale',
        creatureType: this.type
      });
      return 0.06; // Safe fallback scale
    }
  }

  /**
   * Create a fallback graphics representation when sprites are not available
   */
  createFallbackGraphics() {
    try {
      // Try to use the old drawing method if available, otherwise use colored circle
      if (typeof this.drawCreature === 'function') {
        this.sprite = new PIXI.Graphics();
        this.sprite.scale.set(0.7, 0.7);
        this.drawCreature();
      } else {
        this.createFallbackSprite();
      }
    } catch (error) {
      GameErrors.sprites(error, {
        stage: 'createFallbackGraphics',
        creatureType: this.type
      });
      // Last resort - create a simple colored circle
      this.createFallbackSprite();
    }
  }

  /**
   * Create a simple colored circle as the most basic fallback
   */
  createFallbackSprite() {
    try {
      // Color-coded fallback circles for different creature types
      const colorMap = {
        'dragon': 0xFF0000,      // Red
        'skeleton': 0xFFFFFF,    // White
        'beholder': 0x800080,    // Purple
        'goblin': 0x00FF00,      // Green
        'mindflayer': 0x4B0082,  // Indigo
        'minotaur': 0x8B4513,    // Brown
        'orc': 0x808080,         // Gray
        'owlbear': 0xA52A2A,     // Dark Red
        'troll': 0x228B22        // Forest Green
      };
      
      const color = colorMap[this.type] || 0x808080; // Default to gray
      
      this.sprite = new PIXI.Graphics();
      this.sprite.beginFill(color);
      this.sprite.drawCircle(0, 0, 20);
      this.sprite.endFill();
      
    } catch (error) {
      GameErrors.sprites(error, {
        stage: 'createFallbackSprite',
        creatureType: this.type
      });
    }
  }

  /**
   * Apply the facing direction to the sprite
   * Uses different techniques for sprites vs graphics
   */
  applyFacing() {
    if (!this.sprite) return;
    
    try {
      const absScaleX = Math.abs(this.sprite.scale.x);
      const absScaleY = Math.abs(this.sprite.scale.y);
      
      if (this.sprite instanceof PIXI.Sprite) {
        // For PNG sprites, use skew to avoid vertical flipping
        this.sprite.scale.x = absScaleX;
        this.sprite.scale.y = absScaleY;
        this.sprite.skew.y = this.facingRight ? 0 : Math.PI;
      } else {
        // For Graphics objects, simple scale works fine
        this.sprite.scale.x = this.facingRight ? absScaleX : -absScaleX;
        this.sprite.scale.y = absScaleY;
      }
    } catch (error) {
      GameErrors.sprites(error, {
        stage: 'applyFacing',
        creatureType: this.type,
        facingRight: this.facingRight
      });
    }
  }

  /**
   * Set the facing direction of the creature
   * @param {boolean} facingRight - Whether creature should face right
   */
  setFacing(facingRight) {
    this.facingRight = Boolean(facingRight);
    this.applyFacing();
  }

  /**
   * Set the position of the creature
   * @param {number} x - X coordinate
   * @param {number} y - Y coordinate
   */
  setPosition(x, y) {
    try {
      this.x = Sanitizers.integer(x, this.x);
      this.y = Sanitizers.integer(y, this.y);
      
      if (this.sprite) {
        this.sprite.x = this.x;
        this.sprite.y = this.y;
      }
    } catch (error) {
      GameErrors.sprites(error, {
        stage: 'setPosition',
        creatureType: this.type,
        coordinates: { x, y }
      });
    }
  }

  /**
   * Add this creature's sprite to a display container
   * @param {PIXI.Container} stage - Container to add sprite to
   */
  addToStage(stage) {
    try {
      if (!this.sprite) {
        throw new Error('No sprite available to add to stage');
      }
      
      // Validate container
      if (!stage || typeof stage.addChild !== 'function') {
        throw new Error('Invalid stage container provided');
      }
      
      stage.addChild(this.sprite);
    } catch (error) {
      GameErrors.sprites(error, {
        stage: 'addToStage',
        creatureType: this.type,
        hasSprite: !!this.sprite
      });
    }
  }

  /**
   * Remove this creature's sprite from its parent container
   */
  removeFromStage() {
    try {
      if (this.sprite && this.sprite.parent) {
        this.sprite.parent.removeChild(this.sprite);
      }
    } catch (error) {
      GameErrors.sprites(error, {
        stage: 'removeFromStage',
        creatureType: this.type
      });
    }
  }

  /**
   * Recreate the sprite (useful for upgrading from fallback to PNG)
   * Preserves position and parent container
   */
  recreateSprite() {
    try {
      
      // Store current state
      let parent = null;
      let currentX = this.x;
      let currentY = this.y;
      
      // Remove existing sprite and store parent reference
      if (this.sprite && this.sprite.parent) {
        parent = this.sprite.parent;
        currentX = this.sprite.x;
        currentY = this.sprite.y;
        parent.removeChild(this.sprite);
      }
      
      // Create new sprite
      this.createSprite();
      
      // Restore position and parent
      if (this.sprite) {
        this.sprite.x = currentX;
        this.sprite.y = currentY;
        
        if (parent) {
          parent.addChild(this.sprite);
        }
      }
      
    } catch (error) {
      GameErrors.sprites(error, {
        stage: 'recreateSprite',
        creatureType: this.type
      });
    }
  }

  /**
   * Replace fallback graphics with sprite texture
   * Used when sprite becomes available after initial creation
   */
  replaceWithSprite() {
    try {
      const spriteKey = `${this.type}-sprite`;
      const texture = window.spriteManager.getSprite(spriteKey);
      
      if (!texture) {
        console.warn(`🎨 Cannot replace sprite for ${this.type} - texture not available`);
        return;
      }
      
      // Store current position and parent
      const currentX = this.sprite?.x || 0;
      const currentY = this.sprite?.y || 0;
      const parent = this.sprite?.parent;
      
      // Remove old sprite
      if (this.sprite && this.sprite.parent) {
        this.sprite.parent.removeChild(this.sprite);
      }
      
      // Create new sprite with texture
      this.sprite = new PIXI.Sprite(texture);
      this.sprite.anchor.set(0.5);
      
      // Apply creature-specific configuration
      const scale = this.getCreatureScale();
      this.sprite.scale.set(scale, scale);
      this.applyFacing();
      
      // Restore position and add to parent
      this.sprite.x = currentX;
      this.sprite.y = currentY;
      
      if (parent) {
        parent.addChild(this.sprite);
      }
      
    } catch (error) {
      console.error(`❌ Failed to replace sprite for ${this.type}:`, error);
    }
  }
}

export default CreatureToken;
