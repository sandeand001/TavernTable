
// src/entities/creatures/index.js - Global creature creation functions

import CreatureFactory from './CreatureFactory.js';

// Global functions for creating creatures (used by HTML buttons)
function createDragon(x = 0, y = 0) {
	const facingRight = window.tokenFacingRight !== undefined ? window.tokenFacingRight : true;
	return CreatureFactory.createCreature('dragon', x, y, facingRight);
}

function createSkeleton(x = 0, y = 0) {
	const facingRight = window.tokenFacingRight !== undefined ? window.tokenFacingRight : true;
	return CreatureFactory.createCreature('skeleton', x, y, facingRight);
}

function createBeholder(x = 0, y = 0) {
	const facingRight = window.tokenFacingRight !== undefined ? window.tokenFacingRight : true;
	return CreatureFactory.createCreature('beholder', x, y, facingRight);
}

function createGoblin(x = 0, y = 0) {
	const facingRight = window.tokenFacingRight !== undefined ? window.tokenFacingRight : true;
	return CreatureFactory.createCreature('goblin', x, y, facingRight);
}

function createMindFlayer(x = 0, y = 0) {
	const facingRight = window.tokenFacingRight !== undefined ? window.tokenFacingRight : true;
	return CreatureFactory.createCreature('mindflayer', x, y, facingRight);
}

function createOrc(x = 0, y = 0) {
	const facingRight = window.tokenFacingRight !== undefined ? window.tokenFacingRight : true;
	return CreatureFactory.createCreature('orc', x, y, facingRight);
}

function createMinotaur(x = 0, y = 0) {
	const facingRight = window.tokenFacingRight !== undefined ? window.tokenFacingRight : true;
	return CreatureFactory.createCreature('minotaur', x, y, facingRight);
}

function createOwlbear(x = 0, y = 0) {
	const facingRight = window.tokenFacingRight !== undefined ? window.tokenFacingRight : true;
	return CreatureFactory.createCreature('owlbear', x, y, facingRight);
}

function createTroll(x = 0, y = 0) {
	const facingRight = window.tokenFacingRight !== undefined ? window.tokenFacingRight : true;
	return CreatureFactory.createCreature('troll', x, y, facingRight);
}

// Export all creature creation functions
export { 
	createGoblin, 
	createOrc, 
	createSkeleton, 
	createDragon, 
	createBeholder, 
	createTroll, 
	createOwlbear, 
	createMinotaur, 
	createMindFlayer
};
