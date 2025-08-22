// src/entities/creatures/CreatureFactory.js - Factory for creating creature tokens

import CreatureToken from './CreatureToken.js';
import { CREATURE_HELPERS } from '../../config/GameConstants.js';
import { logger, LOG_CATEGORY } from '../../utils/Logger.js';

class CreatureFactory {
    static createCreature(type, x = 0, y = 0, facingRight = true) {
        // Validate creature type using GameConstants
        const validTypes = CREATURE_HELPERS.getAllTypes();

        if (!validTypes.includes(type.toLowerCase())) {
            logger.debug('Unknown creature type requested', { type, validTypes }, LOG_CATEGORY.SYSTEM);
        }

        // Create CreatureToken directly
        return new CreatureToken(type, x, y, facingRight);
    }
}

export default CreatureFactory;
