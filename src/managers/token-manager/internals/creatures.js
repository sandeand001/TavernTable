import { logger, LOG_CATEGORY } from '../../../utils/logger/Logger.js';
import { ErrorHandler, ERROR_SEVERITY, ERROR_CATEGORY } from '../../../utils/error/ErrorHandler.js';
import { GameValidators } from '../../../utils/Validation.js';

import { createCreature } from '../../../entities/creatures/index.js';

// ── Creature Instantiation ─────────────────────────────────────

export function createCreatureByType(c, type) {
  let normalizedType = type;
  try {
    const typeValidation = GameValidators.creatureType(type);
    if (!typeValidation.isValid) {
      throw new Error(`Invalid creature type: ${typeValidation.errors.join(' ')}`);
    }
    normalizedType = typeValidation.normalizedType;
    const facingRight = typeof window !== 'undefined' ? (window.tokenFacingRight ?? true) : true;
    const creature = createCreature(normalizedType, 0, 0, facingRight);
    if (!creature) {
      throw new Error(`Creation function returned null for creature type: ${type}`);
    }

    logger.debug(
      `Created creature: ${normalizedType}`,
      {
        creatureType: normalizedType,
        hasSprite: !!creature.sprite,
      },
      LOG_CATEGORY.SYSTEM
    );

    return creature;
  } catch (error) {
    const errorHandler = new ErrorHandler();
    errorHandler.handle(error, ERROR_SEVERITY.ERROR, ERROR_CATEGORY.TOKEN, {
      stage: 'createCreatureByType',
      creatureType: normalizedType,
    });
    return null;
  }
}
