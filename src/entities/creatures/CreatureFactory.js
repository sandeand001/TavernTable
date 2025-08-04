// src/entities/creatures/CreatureFactory.js - Factory for creating creature tokens

import CreatureToken from './CreatureToken.js';
import { CREATURE_HELPERS } from '../../config/GameConstants.js';

class CreatureFactory {
  static createCreature(type, x = 0, y = 0, facingRight = true) {
    // Validate creature type using GameConstants
    const validTypes = CREATURE_HELPERS.getAllTypes();
    
    if (!validTypes.includes(type.toLowerCase())) {
      console.warn(`Unknown creature type: ${type}. Valid types:`, validTypes);
    }
    
    // Create CreatureToken directly
    return new CreatureToken(type, x, y, facingRight);
  }
}

export default CreatureFactory;
