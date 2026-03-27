// src/entities/creatures/CreatureToken.js - Base class for all creature tokens

import { CREATURE_SCALES } from '../../config/GameConstants.js';
import { logger, LOG_CATEGORY } from '../../utils/Logger.js';
import {
  ErrorHandler,
  ERROR_SEVERITY,
  ERROR_CATEGORY,
  GameErrors,
} from '../../utils/ErrorHandler.js';
import { GameValidators, Sanitizers } from '../../utils/Validation.js';

// ── CreatureToken Class ─────────────────────────────────────────────
/**
 * Base class for all creature tokens in the TavernTable game
 *
 * Provides common functionality for creature positioning, scaling,
 * and interaction management. Visual rendering is handled by
 * Token3DAdapter (3D FBX models); the PIXI Graphics fallback
 * serves as a position/state handle in the container tree.
 *
 * @class CreatureToken
 * @version 2.0.0
 */
class CreatureToken {
  // ── Constructor & Validation ───────────────────────────
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
        coordinateValidation: { x: typeof x, y: typeof y },
      });
      throw error;
    }
  }

  // ── Sprite Creation ───────────────────────────────────
  /**
   * Create the sprite representation for this creature.
   * Uses PIXI.Graphics as a position/state handle; 3D rendering
   * is handled by Token3DAdapter.
   */
  createSprite() {
    try {
      this.createFallbackGraphics();
      this.applyFacing();
    } catch (error) {
      GameErrors.sprites(error, {
        stage: 'createSprite',
        creatureType: this.type,
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
      logger.debug(
        'No scale defined for creature type; using default',
        { type: this.type },
        LOG_CATEGORY.SYSTEM
      );
      return CREATURE_SCALES.mannequin || 0.06;
    } catch (error) {
      GameErrors.validation(error, {
        stage: 'getCreatureScale',
        creatureType: this.type,
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
        // Bottom-center align pivot using local bounds
        try {
          const b = this.sprite.getLocalBounds();
          this.sprite.pivot.set(b.x + b.width / 2, b.y + b.height);
          window.logger?.debug?.('Fallback Graphics pivot set', {
            pivot: this.sprite.pivot,
            bounds: b,
            type: this.type,
          });
        } catch {
          /* ignore bounds error */
        }
      } else {
        this.createFallbackSprite();
      }
    } catch (error) {
      GameErrors.sprites(error, {
        stage: 'createFallbackGraphics',
        creatureType: this.type,
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
        mannequin: 0xcb99ff, // Lavender
      };

      const color = colorMap[this.type] || 0x808080; // Default to gray

      this.sprite = new PIXI.Graphics();
      this.sprite.beginFill(color);
      this.sprite.drawCircle(0, 0, 20);
      this.sprite.endFill();
      // Bottom-center align pivot for fallback circle
      try {
        const b = this.sprite.getLocalBounds();
        this.sprite.pivot.set(b.x + b.width / 2, b.y + b.height);
      } catch {
        /* ignore bounds error */
      }
    } catch (error) {
      GameErrors.sprites(error, {
        stage: 'createFallbackSprite',
        creatureType: this.type,
      });
    }
  }

  // ── Facing & Direction ─────────────────────────────────
  /**
   * Apply the facing direction to the sprite
   */
  applyFacing() {
    if (!this.sprite) return;

    try {
      const absScaleX = Math.abs(this.sprite.scale.x);
      const absScaleY = Math.abs(this.sprite.scale.y);

      this.sprite.scale.x = this.facingRight ? absScaleX : -absScaleX;
      this.sprite.scale.y = absScaleY;
    } catch (error) {
      GameErrors.sprites(error, {
        stage: 'applyFacing',
        creatureType: this.type,
        facingRight: this.facingRight,
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

  // ── Positioning ────────────────────────────────────────
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
        coordinates: { x, y },
      });
    }
  }

  // ── Stage Management ──────────────────────────────────
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
        hasSprite: !!this.sprite,
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
        creatureType: this.type,
      });
    }
  }

  // ── Sprite Recreation ─────────────────────────────────
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
        creatureType: this.type,
      });
    }
  }
}

export default CreatureToken;
