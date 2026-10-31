import { movementImpaired, canRemainAirborne } from './falling.js';
import { edition } from './editions.js';

export function movementSpeed(character, travelMode = 'ground') {
  if (!['ground', 'fly'].includes(travelMode)) {
    throw new Error('Travel mode must be Ground or Fly');
  }
  const speed = travelMode === 'fly' ? (character.fallTraits?.flySpeed ?? 0) : character.speed;
  if (!Number.isFinite(speed) || speed < 0) {
    throw new Error('Movement speed must be a finite, non-negative number of feet');
  }
  return speed;
}

export function flightAvailability(character, { ruleset = '2014' } = {}) {
  edition(ruleset);
  const speed = movementSpeed(character, 'fly');
  if (speed === 0) return { allowed: false, reason: 'This creature has no active flying speed.' };
  if (movementImpaired(character, { ruleset })) {
    return { allowed: false, reason: 'This creature cannot move in its current condition.' };
  }
  if ((character.conditions || []).includes('prone')) {
    return { allowed: false, reason: 'Stand up before using flying movement.' };
  }
  if (!canRemainAirborne(character, { ruleset })) {
    return { allowed: false, reason: 'This creature cannot stay aloft in its current condition.' };
  }
  return { allowed: true, speed };
}
