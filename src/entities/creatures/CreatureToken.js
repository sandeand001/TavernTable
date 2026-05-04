// src/entities/creatures/CreatureToken.js - Base class for all creature tokens

import { CREATURE_SCALES } from '../../config/GameConstants.js';

import { logger, LOG_CATEGORY } from '../../utils/logger/Logger.js';
import {
  ErrorHandler,
  ERROR_SEVERITY,
  ERROR_CATEGORY,
  GameErrors,
} from '../../utils/error/ErrorHandler.js';
import { GameValidators, Sanitizers } from '../../utils/Validation.js';

// ── CreatureToken Class ─────────────────────────────────────────────
/**
 * Base class for all creature tokens in the TavernTable game.
 * Holds logical state (type, position, facing). Visual rendering is
 * handled entirely by Token3DAdapter (3D FBX models).
 */
class CreatureToken {
  constructor(type, x = 0, y = 0, facingRight = true) {
    try {
      const typeValidation = GameValidators.creatureType(type);
      if (!typeValidation.isValid) {
        throw new Error(`Invalid creature type: ${typeValidation.getErrorMessage()}`);
      }

      this.type = type;
      this.x = Sanitizers.integer(x, 0);
      this.y = Sanitizers.integer(y, 0);
      this.facingRight = Boolean(facingRight);
      this.sprite = null; // kept as null; Token3DAdapter owns the 3D visual
    } catch (error) {
      new ErrorHandler().handle(error, ERROR_SEVERITY.HIGH, ERROR_CATEGORY.RENDERING, {
        context: 'CreatureToken.constructor',
        stage: 'token_initialization',
        parameters: { type, x, y, facingRight },
      });
      throw error;
    }
  }

  getCreatureScale() {
    try {
      if (CREATURE_SCALES[this.type]) {
        return CREATURE_SCALES[this.type];
      }
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
      return 0.06;
    }
  }

  setFacing(facingRight) {
    this.facingRight = Boolean(facingRight);
  }

  setPosition(x, y) {
    try {
      this.x = Sanitizers.integer(x, this.x);
      this.y = Sanitizers.integer(y, this.y);
    } catch (error) {
      GameErrors.sprites(error, {
        stage: 'setPosition',
        creatureType: this.type,
        coordinates: { x, y },
      });
    }
  }
}

export default CreatureToken;
