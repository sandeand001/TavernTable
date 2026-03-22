// src/entities/creatures/index.js - Global creature creation functions

import CreatureFactory from './CreatureFactory.js';

function createMannequin(x = 0, y = 0) {
  const facingRight = window.tokenFacingRight !== undefined ? window.tokenFacingRight : true;
  return CreatureFactory.createCreature('mannequin', x, y, facingRight);
}

// Legacy aliases retained for saved states or external scripts not yet migrated.
function createFemaleHumanoid(x = 0, y = 0) {
  return createMannequin(x, y);
}

function createDefeatedDoll(x = 0, y = 0) {
  return createMannequin(x, y);
}

// Export all creature creation functions
export { createMannequin, createFemaleHumanoid, createDefeatedDoll };
