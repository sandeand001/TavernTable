const signed = (value) => `${value >= 0 ? '+' : ''}${value}`;

export function attacksPerAction(character, override = null) {
  if (override !== null) return override;
  if (character.classId === 'fighter') {
    return character.level >= 20 ? 4 : character.level >= 11 ? 3 : character.level >= 5 ? 2 : 1;
  }
  return ['barbarian', 'monk', 'paladin', 'ranger'].includes(character.classId) &&
    character.level >= 5
    ? 2
    : 1;
}

export function characterActionOptions(library, token, choices = {}) {
  const character = library.get(token.characterSheetId);
  const stats = library.stats(character.id);
  const rules = library.rules;
  const unarmored = !character.equipment.some(
    (item) =>
      item.equipped && ['armor', 'shield'].includes(library.catalog.get(item.entryId).equipmentType)
  );
  const unarmedAbility =
    character.classId === 'monk' && unarmored
      ? Math.max(stats.abilityModifiers.strength, stats.abilityModifiers.dexterity)
      : stats.abilityModifiers.strength;
  const actions = rules.standardActions.map((action) => ({
    ...action,
    note: action.unarmedSave
      ? `Target chooses a Strength or Dexterity saving throw, DC ${8 + unarmedAbility + stats.proficiencyBonus}. ${action.note} Confirm Martial Arts eligibility if using Dexterity.`
      : action.note,
    roll: action.skill
      ? {
          expression: `1d20${signed(stats.skills[action.skill])}`,
          label: action.label,
          check: true,
        }
      : null,
    followups: [],
  }));
  for (const attack of stats.attacks) {
    actions.push({
      id: `attack:${attack.itemId}`,
      label: attack.name,
      cost: 'attack',
      kind: 'weapon',
      itemId: attack.itemId,
      roll: {
        expression: `1d20${signed(attack.attackBonus)}`,
        label: `${attack.name} attack`,
        check: true,
        attack: true,
      },
      followups: [
        { expression: attack.damage, label: `${attack.name} damage (${attack.damageType})` },
        ...(attack.versatileDamage
          ? [{ expression: attack.versatileDamage, label: `${attack.name} two-handed damage` }]
          : []),
      ],
    });
  }
  actions.push({
    id: 'attack:unarmed',
    label: 'Unarmed strike',
    cost: 'attack',
    kind: 'weapon',
    roll: {
      expression: `1d20${signed(stats.abilityModifiers.strength + stats.proficiencyBonus)}`,
      label: 'Unarmed strike attack',
      check: true,
      attack: true,
    },
    followups: [
      {
        expression: String(Math.max(0, 1 + stats.abilityModifiers.strength)),
        label: 'Unarmed strike damage',
      },
    ],
  });
  const melee = actions.filter(
    (action) =>
      action.kind === 'weapon' &&
      (!action.itemId ||
        library.catalog.get(stats.attacks.find((attack) => attack.itemId === action.itemId).entryId)
          .weapon.range !== 'ranged')
  );
  const unarmed = actions.find((action) => action.id === 'attack:unarmed');
  if (character.classId === 'monk') {
    if (unarmored) {
      const ability = Math.max(stats.abilityModifiers.strength, stats.abilityModifiers.dexterity);
      const die = rules.martialDie(character.level);
      unarmed.roll.expression = `1d20${signed(ability + stats.proficiencyBonus)}`;
      unarmed.followups = [
        { expression: `1d${die}${signed(ability)}`, label: 'Martial Arts unarmed damage' },
      ];
      actions.push({
        ...unarmed,
        id: 'bonus:martial-arts',
        label: 'Martial Arts bonus strike',
        roll: { ...unarmed.roll, label: 'Martial Arts bonus strike' },
        cost: 'bonus',
        attackRequired: rules.martialArtsNeedsAttack,
        note: rules.martialArtsNeedsAttack
          ? 'Confirm the unarmed/monk-weapon Attack-action requirements.'
          : 'Confirm the unarmored/Monk-weapon Martial Arts requirements.',
      });
    }
    actions.push({
      ...unarmed,
      id: 'bonus:flurry-strike',
      label: 'Flurry unarmed strike',
      roll: { ...unarmed.roll, label: 'Flurry unarmed strike' },
      cost: 'bonus-attack',
    });
  }
  actions.push(
    ...melee.map((action) => ({
      ...action,
      id: action.itemId ? `opportunity:${action.itemId}` : 'opportunity:unarmed',
      label: `Opportunity attack: ${action.label}`,
      roll: { ...action.roll, label: `Opportunity attack: ${action.label}` },
      cost: 'reaction',
      note: 'Confirm a legal opportunity-attack trigger. Extra Attack does not apply.',
    }))
  );
  for (const definition of rules.classActions) {
    if (definition.classId !== character.classId || character.level < definition.level) continue;
    const resourceCost = definition.variableCost ? (choices[definition.id]?.amount ?? 1) : 1;
    if (!Number.isInteger(resourceCost) || resourceCost < 1 || resourceCost > 10000) {
      throw new Error('Choose a valid ability resource amount');
    }
    const healing = definition.healing === 'second-wind' ? `1d10+${character.level}` : null;
    actions.push({
      ...definition,
      kind: 'ability',
      resourceCost,
      ...(definition.effect === 'bonus-attacks'
        ? { bonusAttacks: rules.flurryAttacks(character.level) }
        : {}),
      spellReady: definition.isSpell ? !!stats.castingAbility : true,
      note:
        definition.note ||
        (definition.isSpell
          ? 'Choose the assigned spell and apply targets/effects manually; no ordinary slot is spent.'
          : 'Tracked costs are automatic; resolve other feature conditions and effects manually.'),
      roll: definition.skill
        ? {
            expression: `1d20${signed(stats.skills[definition.skill])}`,
            label: definition.label,
            check: true,
          }
        : healing
          ? { expression: healing, label: 'Second Wind healing', check: false }
          : null,
      followups: healing ? [{ expression: healing, label: 'Second Wind healing' }] : [],
    });
  }
  for (const owned of character.spells) {
    const entry = library.catalog.get(owned.entryId);
    const id = `spell:${owned.id}`;
    const slots =
      entry.level === 0
        ? [0]
        : stats.spellSlots
            .filter((slot) => slot.level >= entry.level && slot.max > 0)
            .map((slot) => slot.level);
    const slotLevel =
      choices[id]?.slotLevel ??
      (entry.level === 0
        ? 0
        : (stats.spellSlots.find((slot) => slot.level >= entry.level && slot.remaining > 0)
            ?.level ?? entry.level));
    const spell = library.spell(character.id, owned.id, slotLevel);
    const time = entry.castingTime.toLowerCase();
    const cost = /^(?:1\s+)?bonus action\b/.test(time)
      ? 'bonus'
      : /^(?:1\s+)?reaction\b/.test(time)
        ? 'reaction'
        : /^(?:1\s+)?action\b/.test(time)
          ? 'action'
          : 'long';
    const spellReady =
      !!stats.castingAbility &&
      (entry.level === 0 ||
        ((!stats.preparesSpells || owned.prepared) &&
          (stats.spellSlots[slotLevel - 1]?.remaining ?? 0) > 0));
    actions.push({
      id,
      label: entry.name,
      cost,
      kind: 'spell',
      spellId: owned.id,
      spellLevel: entry.level,
      usesSlot: entry.level > 0,
      slotLevel,
      slotLevels: slots,
      spellReady,
      note: `${entry.castingTime}; ${entry.range}; ${entry.duration}. Resolve targets and effects manually. ${(entry.automationNotes || []).join(' ')}`,
      roll:
        spell.attackBonus === null
          ? null
          : {
              expression: `1d20${signed(spell.attackBonus)}`,
              label: `${entry.name} spell attack`,
              check: true,
              attack: true,
            },
      followups: [
        ...spell.damage
          .filter((part) => part.notation)
          .map((part) => ({
            expression: part.notation,
            label: `${entry.name} damage (${part.type})`,
          })),
        ...(spell.healing ? [{ expression: spell.healing, label: `${entry.name} healing` }] : []),
      ],
    });
  }
  for (const entry of library.actions.list(character.id)) {
    actions.push({
      id: `custom:${entry.id}`,
      customId: entry.id,
      label: entry.name,
      cost: entry.cost,
      kind: 'custom',
      note: entry.note,
      magicAction: entry.magicAction === true,
      roll: null,
      followups: [],
      resourceId: entry.resourceId,
      resourceCost: entry.resourceCost,
      maximum: entry.maximum,
      reset: entry.reset,
    });
  }
  return actions;
}
