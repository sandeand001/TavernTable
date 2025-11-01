import { logger, LOG_CATEGORY } from '../../../utils/Logger.js';
import { ErrorHandler, ERROR_SEVERITY, ERROR_CATEGORY } from '../../../utils/ErrorHandler.js';
import { GameValidators } from '../../../utils/Validation.js';

// Creature creation functions
import {
  createGoblin,
  createOrc,
  createSkeleton,
  createDragon,
  createBeholder,
  createTroll,
  createOwlbear,
  createMinotaur,
  createMindFlayer,
  createFemaleHumanoid,
} from '../../../entities/creatures/index.js';

export function createCreatureByType(c, type) {
  try {
    const typeValidation = GameValidators.creatureType(type);
    if (!typeValidation.isValid) {
      throw new Error(`Invalid creature type: ${typeValidation.getErrorMessage()}`);
    }

    const creationFunctions = {
      goblin: () => createGoblin(),
      orc: () => createOrc(),
      skeleton: () => createSkeleton(),
      dragon: () => createDragon(),
      beholder: () => createBeholder(),
      troll: () => createTroll(),
      owlbear: () => createOwlbear(),
      minotaur: () => createMinotaur(),
      mindflayer: () => createMindFlayer(),
      'female-humanoid': () => createFemaleHumanoid(),
    };

    const createFn = creationFunctions[type];
    if (!createFn) {
      throw new Error(`No creation function found for creature type: ${type}`);
    }

    const creature = createFn();
    if (!creature) {
      throw new Error(`Creation function returned null for creature type: ${type}`);
    }

    logger.debug(
      `Created creature: ${type}`,
      {
        creatureType: type,
        hasSprite: !!creature.sprite,
      },
      LOG_CATEGORY.SYSTEM
    );

    return creature;
  } catch (error) {
    const errorHandler = new ErrorHandler();
    errorHandler.handle(error, ERROR_SEVERITY.ERROR, ERROR_CATEGORY.TOKEN, {
      stage: 'createCreatureByType',
      creatureType: type,
    });
    return null;
  }
}
