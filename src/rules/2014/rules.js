import { CHARACTER_REST_RESOURCES } from '../../config/CharacterRestResources.js';
import { STANDARD_COMBAT_ACTIONS, CLASS_COMBAT_ACTIONS } from '../../config/CombatActions.js';

export default Object.freeze({
  id: '2014',
  restResources: CHARACTER_REST_RESOURCES,
  standardActions: STANDARD_COMBAT_ACTIONS,
  classActions: CLASS_COMBAT_ACTIONS,
  martialArtsNeedsAttack: true,
  martialDie: (level) => (level >= 17 ? 10 : level >= 11 ? 8 : level >= 5 ? 6 : 4),
  flurryAttacks: () => 2,
  hitDiceRecovery: (level, spent) => Math.min(spent, Math.max(1, Math.floor(level / 2))),
  hitDieHealing: (roll, modifier) => Math.max(0, roll + modifier),
  canStartShortRest: () => true,
  shortRestChoices: () => [],
  shortRestRecovery: ({ choices }) => {
    if (
      !choices ||
      typeof choices !== 'object' ||
      Array.isArray(choices) ||
      Object.keys(choices).length
    ) {
      throw new Error('Unsupported short-rest recovery choice for the 2014 ruleset');
    }
    return { changes: [], restored: [] };
  },
  preparesSpells: (classId) => ['wizard', 'cleric', 'druid', 'paladin'].includes(classId),
  canCastSpell: (action, spells, { isTurn }) =>
    !isTurn ||
    (!(
      action.cost === 'bonus' &&
      spells.some((spell) => spell.cost !== 'action' || spell.level !== 0)
    ) &&
      !(
        spells.some((spell) => spell.cost === 'bonus') &&
        !(action.cost === 'action' && action.spellLevel === 0)
      )),
  surgeRestricted: false,
  canUseSurgeAction: () => true,
});
