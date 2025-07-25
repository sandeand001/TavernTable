// js/creatures/index.js - Global creature creation functions

// Global functions for creating creatures (used by HTML buttons)
function createDragon(x, y) {
  const facingRight = window.tokenFacingRight !== undefined ? window.tokenFacingRight : true;
  return CreatureFactory.createCreature('dragon', x, y, facingRight);
}

function createSkeleton(x, y) {
  const facingRight = window.tokenFacingRight !== undefined ? window.tokenFacingRight : true;
  return CreatureFactory.createCreature('skeleton', x, y, facingRight);
}

function createBeholder(x, y) {
  const facingRight = window.tokenFacingRight !== undefined ? window.tokenFacingRight : true;
  return CreatureFactory.createCreature('beholder', x, y, facingRight);
}

function createGoblin(x, y) {
  const facingRight = window.tokenFacingRight !== undefined ? window.tokenFacingRight : true;
  return CreatureFactory.createCreature('goblin', x, y, facingRight);
}

function createMindFlayer(x, y) {
  const facingRight = window.tokenFacingRight !== undefined ? window.tokenFacingRight : true;
  return CreatureFactory.createCreature('mindflayer', x, y, facingRight);
}

function createMinotaur(x, y) {
  const facingRight = window.tokenFacingRight !== undefined ? window.tokenFacingRight : true;
  return CreatureFactory.createCreature('minotaur', x, y, facingRight);
}

function createOrc(x, y) {
  const facingRight = window.tokenFacingRight !== undefined ? window.tokenFacingRight : true;
  return CreatureFactory.createCreature('orc', x, y, facingRight);
}

function createOwlbear(x, y) {
  const facingRight = window.tokenFacingRight !== undefined ? window.tokenFacingRight : true;
  return CreatureFactory.createCreature('owlbear', x, y, facingRight);
}

function createTroll(x, y) {
  const facingRight = window.tokenFacingRight !== undefined ? window.tokenFacingRight : true;
  return CreatureFactory.createCreature('troll', x, y, facingRight);
}
