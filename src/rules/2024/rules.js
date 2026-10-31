import restResources from './resources.js';
import { STANDARD_ACTIONS, CLASS_ACTIONS } from './actions.js';
import {
  fallingDice,
  standingCost,
  fallProtection,
  resolveFall,
  movementImpaired,
  cannotTakeActions,
  canRemainAirborne,
} from '../falling.js';
import { flightAvailability } from '../flight.js';

function shortRestChoices(character, resources) {
  const pool = resources.find((resource) => resource.id === 'sorcery-points');
  const recovery = resources.find((resource) => resource.id === 'sorcerous-restoration');
  if (
    character.classId !== 'sorcerer' ||
    character.level < 5 ||
    !pool?.used ||
    !recovery?.remaining
  )
    return [];
  return [
    {
      id: 'sorcerousRestoration',
      label: `Use Sorcerous Restoration to regain ${Math.min(pool.used, Math.floor(character.level / 2))} Sorcery Points (once per Long Rest)`,
    },
  ];
}

function shortRestRecovery({ character, resources, choices }) {
  if (
    !choices ||
    typeof choices !== 'object' ||
    Array.isArray(choices) ||
    Object.entries(choices).some(
      ([key, value]) => key !== 'sorcerousRestoration' || typeof value !== 'boolean'
    )
  ) {
    throw new Error('Unsupported short-rest recovery choice for the 2024 ruleset');
  }
  if (!choices.sorcerousRestoration) return { changes: [], restored: [] };
  const pool = resources.find((resource) => resource.id === 'sorcery-points');
  const recovery = resources.find((resource) => resource.id === 'sorcerous-restoration');
  if (!pool || !recovery) throw new Error('Sorcerous Restoration requires a level 5 Sorcerer');
  if (recovery.remaining < 1)
    throw new Error('Sorcerous Restoration requires a Long Rest before another use');
  if (pool.used < 1) throw new Error('No Sorcery Points need recovery');
  const amount = Math.min(pool.used, Math.floor(character.level / 2));
  return {
    changes: [
      { id: pool.id, used: pool.used - amount },
      { id: recovery.id, used: recovery.used + 1 },
    ],
    restored: [`Sorcery Points (+${amount})`],
  };
}

export default Object.freeze({
  id: '2024',
  restResources,
  standardActions: STANDARD_ACTIONS,
  classActions: CLASS_ACTIONS,
  fallingDice,
  standingCost,
  fallProtection: (character, { ignoreFlight = false } = {}) =>
    fallProtection(character, { ignoreFlight, ruleset: '2024' }),
  resolveFall,
  movementImpaired: (character) => movementImpaired(character, { ruleset: '2024' }),
  cannotTakeActions,
  canRemainAirborne: (character) => canRemainAirborne(character, { ruleset: '2024' }),
  flightAvailability: (character) => flightAvailability(character, { ruleset: '2024' }),
  martialArtsNeedsAttack: false,
  martialDie: (level) => (level >= 17 ? 12 : level >= 11 ? 10 : level >= 5 ? 8 : 6),
  flurryAttacks: (level) => (level >= 10 ? 3 : 2),
  hitDiceRecovery: (level, spent) => spent,
  hitDieHealing: (roll, modifier) => Math.max(1, roll + modifier),
  canStartShortRest: (character) => character.hp.current > 0,
  shortRestChoices,
  shortRestRecovery,
  preparesSpells: (classId) =>
    ['bard', 'cleric', 'druid', 'paladin', 'ranger', 'sorcerer', 'warlock', 'wizard'].includes(
      classId
    ),
  canCastSpell: (action, spells) => !action.usesSlot || !spells.some((spell) => spell.usesSlot),
  surgeRestricted: true,
  canUseSurgeAction: (action) => !(action.kind === 'spell' || action.isSpell || action.magicAction),
});
