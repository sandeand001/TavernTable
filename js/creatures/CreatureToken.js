// js/creatures/CreatureToken.js - Base class for all creature tokens

import { getCreatureScale, getCreatureColor, CREATURE_DEFAULTS } from '../config/CreatureConfig.js';

/**
 * Represents a creature token that can be placed on the game grid
 * Handles sprite creation, scaling, positioning, and facing direction
 */
class CreatureToken {
  /**
   * Create a new creature token
   * @param {string} type - The creature type (e.g., 'skeleton', 'dragon')
   * @param {number} x - Initial X coordinate (default: 0)
   * @param {number} y - Initial Y coordinate (default: 0)
   * @param {boolean} facingRight - Initial facing direction (default: true)
   */
  constructor(type, x = 0, y = 0, facingRight = true) {
    // Validate creature type
    if (!type || typeof type !== 'string') {
      throw new Error('CreatureToken requires a valid type string');
    }
    
    this.type = type.toLowerCase();
    this.x = x;
    this.y = y;
    this.facingRight = facingRight;
    this.sprite = null;
    
    this.createSprite();
  }

  /**
   * Create the sprite for this creature token
   * Attempts to use PNG sprite first, falls back to graphics if unavailable
   */
  createSprite() {
    try {
      // Try to create sprite from PNG file first
      this.createCreatureSprite();
      
      // Apply facing direction after sprite creation
      this.applyFacing();
    } catch (error) {
      console.error(`Failed to create sprite for ${this.type}:`, error);
      this.createFallbackGraphics();
    }
  }

  createCreatureSprite() {
    // Check if sprite manager is ready
    if (!window.spriteManager || !window.spriteManager.isLoaded()) {
      this.createFallbackGraphics();
      return;
    }
    
    const spriteKey = `${this.type}-sprite`;
    
    // Check if this specific sprite is available
    if (!window.spriteManager.hasSpriteLoaded(spriteKey)) {
      this.createFallbackGraphics();
      return;
    }
    
    const texture = window.spriteManager.getSprite(spriteKey);
    if (!texture) {
      this.createFallbackGraphics();
      return;
    }
    
    this.sprite = new PIXI.Sprite(texture);
    this.sprite.anchor.set(0.5, 0.5);
    
    // Set scale based on creature type
    const scale = this.getCreatureScale();
    this.sprite.scale.set(scale, scale);
  }

  createFallbackGraphics() {
    // Try to use the old drawing method if available, otherwise use colored circle
    if (typeof this.drawCreature === 'function') {
      this.sprite = new PIXI.Graphics();
      // Apply creature-specific scale instead of hardcoded 0.7
      const scale = this.getCreatureScale();
      this.sprite.scale.set(scale, scale);
      this.drawCreature();
    } else {
      this.createFallbackSprite();
    }
  }

  /**
   * Get the appropriate scale for this creature type
   * Uses centralized configuration with GameConfig override support
   * @returns {number} The scale multiplier for this creature
   */
  getCreatureScale() {
    // Check if we have GameConfig with creature overrides
    if (window.GameConfig?.creatures?.overrides) {
      const override = window.GameConfig.creatures.overrides[this.type];
      if (override?.scale) {
        console.log(`Using GameConfig scale for ${this.type}: ${override.scale}`);
        return override.scale;
      }
    }
    
    // Use centralized configuration
    const scale = getCreatureScale(this.type);
    console.log(`Using configured scale for ${this.type}: ${scale}`);
    return scale;
  }

  /**
   * Create a simple colored circle as fallback sprite
   * Uses centralized configuration for consistent styling
   */
  createFallbackSprite() {
    const color = getCreatureColor(this.type);
    
    this.sprite = new PIXI.Graphics();
    this.sprite.beginFill(color);
    // Use consistent base radius from configuration
    this.sprite.drawCircle(0, 0, CREATURE_DEFAULTS.radius);
    this.sprite.endFill();
    
    // Apply creature-specific scale
    const scale = this.getCreatureScale();
    this.sprite.scale.set(scale, scale);
  }

  applyFacing() {
    if (!this.sprite) return;
    
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
  }

  setFacing(facingRight) {
    this.facingRight = facingRight;
    this.applyFacing();
  }

  setPosition(x, y) {
    this.x = x;
    this.y = y;
    if (this.sprite) {
      this.sprite.x = x;
      this.sprite.y = y;
    }
  }

  addToStage(stage) {
    if (this.sprite) {
      stage.addChild(this.sprite);
    }
  }

  removeFromStage() {
    if (this.sprite && this.sprite.parent) {
      this.sprite.parent.removeChild(this.sprite);
    }
  }

  // Method to recreate sprite (useful for upgrading from fallback to PNG)
  recreateSprite() {
    console.log(`Recreating sprite for ${this.type}`);
    
    // Remove existing sprite
    if (this.sprite && this.sprite.parent) {
      const parent = this.sprite.parent;
      const x = this.sprite.x;
      const y = this.sprite.y;
      
      parent.removeChild(this.sprite);
      
      // Create new sprite
      this.createSprite();
      
      // Restore position
      if (this.sprite) {
        this.sprite.x = x;
        this.sprite.y = y;
        parent.addChild(this.sprite);
      }
    } else {
      // Just recreate if no parent
      this.createSprite();
    }
  }
}

export default CreatureToken;
