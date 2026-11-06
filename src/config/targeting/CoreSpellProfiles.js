function group(kind, names, options = {}) {
  return Object.fromEntries(
    names
      .trim()
      .split(/\s+/)
      .map((name) => [
        `spell:${name}`,
        {
          kind,
          rangeFeet: kind === 'self' ? 0 : 'spell',
          durationFromSpell: true,
          durationTarget: kind === 'self' ? 'caster' : kind === 'tokens' ? 'targets' : 'point',
          ...options,
        },
      ])
  );
}

function configure(profiles, names, options) {
  return Object.fromEntries(
    names
      .trim()
      .split(/\s+/)
      .map((name) => {
        const id = `spell:${name}`;
        if (!profiles[id]) throw new Error(`Unknown reviewed spell: ${id}`);
        return [id, { ...profiles[id], ...options }];
      })
  );
}

const sightTargets = `animal-friendship animal-messenger animal-shapes banishment blight
  charm-person command compulsion counterspell disintegrate divine-word dominate-beast
  dominate-monster dominate-person enthrall eyebite finger-of-death flesh-to-stone
  geas harm haste heal hellish-rebuke hideous-laughter hold-monster hunters-mark
  imprisonment irresistible-dance levitate mass-heal mass-healing-word mass-suggestion
  maze modify-memory phantasmal-killer polymorph power-word-kill power-word-stun
  sacred-flame seeming suggestion teleport vicious-mockery`;
const sightLocations = `demiplane earthquake faithful-hound floating-disk guardian-of-faith
  heat-metal knock magic-circle major-image passwall telekinesis`;
const willingTargets = `barkskin darkvision foresight freedom-of-movement gaseous-form
  guidance haste heroism mage-armor mind-blank nondetection protection-from-energy
  protection-from-evil-and-good resistance spider-climb stoneskin true-seeing`;

const pointNote =
  'Choose the object or location on the board. Object eligibility, creation, travel and other mechanical effects remain manual.';
const summonNote =
  'Choose the summoning location. The marker tracks location and duration, not a creature stat block, commands or attacks. Add summoned creatures and resolve their actions manually.';
const areaNote =
  'The template and duration are tracked. Saves, damage, conditions, terrain, visibility and conditional ending rules remain manual.';
const area = (shape, sizeFeet, options = {}) => ({
  kind: 'area',
  rangeFeet: 'spell',
  shape,
  sizeFeet,
  durationFromSpell: true,
  durationTarget: 'area',
  coverageNote: areaNote,
  ...options,
});
const burst = (shape, sizeFeet, options = {}) =>
  area(shape, sizeFeet, { durationFromSpell: false, durationTarget: null, ...options });
const aura = (sizeFeet, options = {}) =>
  area('sphere', sizeFeet, {
    rangeFeet: 0,
    anchor: 'caster',
    followCaster: true,
    ...options,
  });
const manual = (reason) => ({ kind: 'manual', reason });
const move = (distanceFeet, cost, options = {}) => ({
  distanceFeet,
  cost,
  magicAction: false,
  casterRangeFeet: null,
  laterTurnsOnly: false,
  ...options,
});

const CORE = {
  ...group(
    'self',
    `alter-self blink blur commune commune-with-nature comprehend-languages
    contact-other-plane contingency detect-thoughts disguise-self dispel-evil-and-good
    divine-favor etherealness expeditious-retreat false-life fire-shield flame-blade
    glibness legend-lore locate-animals-or-plants locate-creature locate-object
    meld-into-stone mirror-image mislead produce-flame see-invisibility shapechange
    speak-with-animals speak-with-plants time-stop tree-stride`,
    {
      coverageNote:
        'The caster and duration are tracked. Additional forms, attacks, information, destinations and conditional endings are resolved manually.',
    }
  ),
  ...group(
    'tokens',
    `acid-arrow bestow-curse blight blindness-deafness chill-touch command contagion
    counterspell darkvision death-ward dominate-beast dominate-monster dominate-person
    finger-of-death flesh-to-stone harm heal hellish-rebuke hideous-laughter
    hunters-mark inflict-wounds irresistible-dance jump lesser-restoration longstrider
    mage-armor maze mind-blank modify-memory phantasmal-killer poison-spray
    power-word-kill power-word-stun ray-of-enfeeblement regenerate remove-curse
    resistance sacred-flame sanctuary shield-of-faith shocking-grasp spare-the-dying
    speak-with-dead suggestion tongues true-seeing vicious-mockery`,
    {
      coverageNote:
        'Choose the creature. Saves, hit-point and condition requirements, damage, bonuses, commands and early endings remain manual.',
    }
  ),
  ...group(
    'tokens',
    `barkskin foresight freedom-of-movement gaseous-form greater-invisibility greater-restoration
    guidance haste heroism nondetection protection-from-energy protection-from-evil-and-good
    protection-from-poison spider-climb stoneskin`,
    {
      preferred: 'friendly',
      coverageNote:
        'Choose the recipient. This is a timed reminder, not automatic healing, statistics, movement or condition application.',
    }
  ),
  ...group(
    'point',
    `antipathy-sympathy arcane-lock arcanists-magic-aura awaken clone continual-flame
    create-food-and-water creation demiplane dispel-magic druidcraft fabricate
    gentle-repose heat-metal identify illusory-script instant-summons knock light
    magic-jar magic-mouth magic-weapon mending message prestidigitation rope-trick
    secret-chest sequester stone-shape thaumaturgy transport-via-plants`,
    { coverageNote: pointNote }
  ),
  ...group(
    'point',
    `conjure-animals conjure-celestial conjure-elemental conjure-fey
    conjure-minor-elementals conjure-woodland-beings create-undead find-familiar
    find-steed giant-insect phantom-steed planar-ally`,
    { coverageNote: summonNote }
  ),
  ...group('tokens', 'aid', {
    targets: [3, 0, 0],
    preferred: 'friendly',
  }),
  ...group('tokens', 'animal-messenger', {
    creatureTypes: ['beast'],
    creatureSizes: ['tiny'],
    requiresSight: true,
    manualUpcastDuration: true,
    coverageNote:
      'Choose a visible Tiny beast. The message, destination, delivery and higher-slot duration are manual.',
  }),
  ...group('tokens', 'astral-projection', {
    targets: [9, 0, 0],
    requireCasterTarget: true,
    requiresWilling: true,
    coverageNote:
      'Select the caster and willing travelers. Astral bodies, equipment, planar travel and ending conditions remain manual.',
  }),
  ...group('self', 'augury branding-smite divination find-the-path goodberry shillelagh'),
  ...group('tokens', 'disintegrate geas guiding-bolt levitate polymorph imprisonment', {
    requiresSight: true,
    coverageNote:
      'Choose the creature. Object alternatives, target eligibility, saves, transformations and all mechanical changes remain manual.',
  }),
  ...group('tokens', 'geas', {
    requiresSight: true,
    manualUpcastDuration: true,
  }),
  ...group('tokens', 'dominate-beast dominate-person dominate-monster', {
    requiresSight: true,
    manualUpcastDuration: true,
  }),
  ...group('tokens', 'dominate-beast', {
    creatureTypes: ['beast'],
    requiresSight: true,
    manualUpcastDuration: true,
  }),
  ...group('tokens', 'dominate-person', {
    creatureTypes: ['humanoid'],
    requiresSight: true,
    manualUpcastDuration: true,
  }),
  ...group('tokens', 'bestow-curse', {
    manualUpcastDuration: true,
    durationTurnsBySlot: { 4: 100 },
    manualFromSlot: 5,
    upcastReason:
      'At level 5 and higher, Bestow Curse changes its duration and can remove its concentration requirement. Apply that higher-slot effect and concentration manually.',
    coverageNote:
      'Higher-slot duration and concentration exceptions require manual correction; the tracker does not apply the curse.',
  }),
  ...group('tokens', 'feather-fall', {
    targets: [5, 0, 0],
    preferred: 'friendly',
    coverageNote:
      'Confirm the falling trigger. This is a timed recipient reminder; apply the Feather Fall protection in Core manually.',
  }),
  ...group('tokens', 'planar-binding', {
    creatureTypes: ['celestial', 'elemental', 'fey', 'fiend'],
    manualUpcastDuration: true,
  }),
  ...group('tokens', 'resilient-sphere', {
    creatureSizes: ['tiny', 'small', 'medium', 'large'],
    coverageNote:
      'Creature-target mode. Object targets, saves and the sphere containment effects remain manual.',
  }),
  ...group('tokens', 'warding-bond', {
    requiresWilling: true,
    preferred: 'friendly',
    coverageNote:
      'Check the material rings and the 60-foot separation ending rule manually; damage sharing and bonuses are not automated.',
  }),
  ...group(
    'point',
    `animate-dead clairvoyance floating-disk magnificent-mansion minor-illusion
    passwall programmed-illusion project-image raise-dead reincarnate resurrection
    revivify simulacrum true-resurrection telekinesis`,
    { coverageNote: pointNote }
  ),
  'spell:dimension-door': {
    kind: 'point',
    rangeFeet: 'spell',
    ignoreOriginCover: true,
    coverageNote:
      'Choose an on-board destination without a line-of-effect restriction. Passenger eligibility, destination hazards and actual travel remain manual.',
  },
  'spell:misty-step': {
    kind: 'point',
    rangeFeet: 30,
    requiresSight: true,
    ignoreOriginCover: true,
    coverageNote:
      'Choose a visible unoccupied destination. The template checks range; occupancy and actual teleportation remain manual.',
  },
  'spell:eyebite': {
    kind: 'tokens',
    rangeFeet: 60,
    requiresSight: true,
    durationFromSpell: true,
    durationTarget: 'caster',
    coverageNote:
      'Select the initial target. Later action-cost target choices, saves and chosen effects remain manual.',
  },
  'spell:find-traps': {
    kind: 'self',
    rangeFeet: 0,
    coverageNote:
      'This is a sensing spell, not automatic trap detection; resolve the 120-foot line-of-sight information manually.',
  },
  'spell:heroes-feast': {
    kind: 'point',
    rangeFeet: 30,
    coverageNote:
      'Choose the feast location. Consumption time, participants, healing and day-long benefits remain manual.',
  },
  'spell:private-sanctum': area('cube', 100),
  'spell:vampiric-touch': {
    kind: 'tokens',
    rangeFeet: 5,
    durationFromSpell: true,
    durationTarget: 'caster',
    meleeAttack: true,
    coverageNote:
      'This selects the initial melee target and tracks the caster duration. Healing and later action-cost attacks without another slot remain manual.',
  },
  'spell:control-weather': aura(26400, {
    coverageNote:
      'This shows the five-mile weather region. Weather stages, the outdoor requirement and environmental changes remain manual.',
  }),
  'spell:call-lightning': area('cylinder', 60, {
    heightFeet: 10,
    defaultElevationFeet: 100,
    minOriginHeightFeet: 100,
    requiresSight: true,
    coverageNote: `${areaNote} This places the cloud, not its individual five-foot lightning strikes; initial and later strikes require manual targets and action accounting.`,
  }),
  'spell:blade-barrier': area('wall', 100, {
    widthFeet: 5,
    heightFeet: 20,
    variants: [
      {
        id: 'wall',
        label: 'Straight wall',
        shape: 'wall',
        sizeFeet: 100,
        widthFeet: 5,
        heightFeet: 20,
      },
      { id: 'ring', label: 'Ring', shape: 'ring', sizeFeet: 30, widthFeet: 5, heightFeet: 20 },
    ],
  }),
  'spell:wall-of-fire': area('wall', 60, {
    widthFeet: 1,
    heightFeet: 20,
    variants: [
      {
        id: 'wall',
        label: 'Straight wall',
        shape: 'wall',
        sizeFeet: 60,
        widthFeet: 1,
        heightFeet: 20,
      },
      { id: 'ring', label: 'Ring', shape: 'ring', sizeFeet: 10, widthFeet: 1, heightFeet: 20 },
    ],
    coverageNote: `${areaNote} Choose the damaging side and resolve its ten-foot damage band manually.`,
  }),
  'spell:wall-of-thorns': area('wall', 60, {
    widthFeet: 5,
    heightFeet: 10,
    variants: [
      {
        id: 'wall',
        label: 'Straight wall',
        shape: 'wall',
        sizeFeet: 60,
        widthFeet: 5,
        heightFeet: 10,
      },
      { id: 'ring', label: 'Ring', shape: 'ring', sizeFeet: 10, widthFeet: 5, heightFeet: 20 },
    ],
  }),
  'spell:wind-wall': area('wall', 50, {
    widthFeet: 1,
    heightFeet: 15,
    coverageNote: `${areaNote} This previews a straight wall; a custom continuous path and projectile deflection remain manual.`,
  }),
  'spell:wall-of-force': area('wall', 100, {
    widthFeet: 1 / 48,
    heightFeet: 10,
    variants: [
      {
        id: 'wall',
        label: 'Straight panels',
        shape: 'wall',
        sizeFeet: 100,
        widthFeet: 1 / 48,
        heightFeet: 10,
      },
      {
        id: 'sphere',
        label: 'Sphere',
        shape: 'sphere',
        sizeFeet: 10,
        widthFeet: 1,
        heightFeet: 10,
      },
      {
        id: 'dome',
        label: 'Dome',
        shape: 'hemisphere',
        sizeFeet: 10,
        widthFeet: 1,
        heightFeet: 10,
      },
    ],
    coverageNote: `${areaNote} Other connected-panel arrangements, collision, passage and line-of-effect blocking remain manual.`,
  }),
  'spell:wall-of-ice': area('wall', 100, {
    widthFeet: 1,
    heightFeet: 10,
    variants: [
      {
        id: 'wall',
        label: 'Straight panels',
        shape: 'wall',
        sizeFeet: 100,
        widthFeet: 1,
        heightFeet: 10,
      },
      {
        id: 'sphere',
        label: 'Sphere',
        shape: 'sphere',
        sizeFeet: 10,
        widthFeet: 1,
        heightFeet: 10,
      },
      {
        id: 'dome',
        label: 'Dome',
        shape: 'hemisphere',
        sizeFeet: 10,
        widthFeet: 1,
        heightFeet: 10,
      },
    ],
    coverageNote: `${areaNote} Custom panel arrangements, broken sections and residual freezing air remain manual.`,
  }),
  'spell:wall-of-stone': area('wall', 100, {
    widthFeet: 0.5,
    heightFeet: 10,
    coverageNote: `${areaNote} This shows ten straight ten-foot panels. Other panel layouts, bridges, damage and permanent terrain after full concentration remain manual.`,
  }),
  'spell:prismatic-wall': area('wall', 90, {
    widthFeet: 1 / 12,
    heightFeet: 30,
    variants: [
      { id: 'wall', label: 'Wall', shape: 'wall', sizeFeet: 90, widthFeet: 1 / 12, heightFeet: 30 },
      {
        id: 'sphere',
        label: 'Sphere',
        shape: 'sphere',
        sizeFeet: 15,
        widthFeet: 1,
        heightFeet: 30,
      },
    ],
    coverageNote: `${areaNote} Layer destruction, saves and passage effects remain manual.`,
  }),
  'spell:forcecage': area('cube', 20, {
    variants: [
      { id: 'cage', label: 'Barred cage', shape: 'cube', sizeFeet: 20 },
      { id: 'box', label: 'Solid box', shape: 'cube', sizeFeet: 10 },
    ],
    coverageNote: `${areaNote} Containment, teleport escape saves, bars and physical cover are not applied automatically.`,
  }),
  'spell:dream': manual(
    'Dream targets a known sleeping creature beyond ordinary board range; identity, sleep, messages and the dream encounter remain manual.'
  ),
  'spell:enlarge-reduce': manual(
    'Enlarge/Reduce can target a creature or an object. Choose and adjudicate the eligible target manually until mixed target controls are available.'
  ),
  'spell:plane-shift': manual(
    'Plane Shift has a willing-travelers mode and an unwilling melee-attack mode, with an off-plane destination. Choose and resolve that mode manually.'
  ),
  'spell:scrying': manual(
    'Scrying targets a known creature or a previously seen location, potentially outside the board. Identity, familiarity and remote sensors remain manual.'
  ),
  'spell:true-polymorph': manual(
    'True Polymorph has creature-to-creature, object-to-creature and creature-to-object modes with different eligibility and permanent-ending rules. Choose and resolve that mode manually.'
  ),
  'spell:sending': manual(
    'Sending targets a creature known to the caster at unlimited distance, possibly on another plane. Select that off-board recipient and resolve delivery manually.'
  ),
  'spell:storm-of-vengeance': manual(
    'Storm of Vengeance combines an elevated storm cloud, a downward affected region, and different effects each round. Its multi-stage vertical area remains manual.'
  ),
  ...group('tokens', 'animal-friendship', {
    creatureTypes: ['beast'],
    targets: [1, 1, 1],
    coverageNote:
      'Check the creature Intelligence restriction in 2014 and resolve the save manually.',
  }),
  ...group('tokens', 'animal-shapes', {
    targets: [2000, 0, 0],
    requiresWilling: true,
    requiresSight: true,
    preferred: 'friendly',
  }),
  ...group('tokens', 'beacon-of-hope', { targets: [2000, 0, 0], preferred: 'friendly' }),
  ...group('tokens', 'compulsion enthrall', {
    targets: [2000, 0, 0],
    requiresSight: true,
    coverageNote:
      'The chosen creatures must also be able to hear you. Hearing, saves and compelled movement remain manual.',
  }),
  ...group('tokens', 'charm-person', {
    creatureTypes: ['humanoid'],
    targets: [1, 1, 1],
    requiresSight: true,
  }),
  ...group('tokens', 'banishment', { targets: [1, 4, 1], requiresSight: true }),
  ...group('tokens', 'blindness-deafness', { targets: [1, 2, 1] }),
  ...group('tokens', 'enhance-ability', {
    targets: [1, 2, 1],
    preferred: 'friendly',
  }),
  ...group('tokens', 'hold-monster', { targets: [1, 5, 1], requiresSight: true }),
  ...group('tokens', 'invisibility', {
    targets: [1, 2, 1],
    preferred: 'friendly',
    coverageNote:
      'The reminder does not apply Invisible or automatically detect its early ending conditions.',
  }),
  ...group('tokens', 'mass-healing-word prayer-of-healing', {
    targets: [6, 0, 0],
    preferred: 'friendly',
    requiresSight: true,
  }),
  ...group('tokens', 'mass-heal', {
    targets: [2000, 0, 0],
    preferred: 'friendly',
    requiresSight: true,
    coverageNote: 'Allocate the spell healing pool between the selected creatures manually.',
  }),
  ...group('tokens', 'mass-suggestion', {
    targets: [12, 0, 0],
    requiresSight: true,
    manualUpcastDuration: true,
  }),
  ...group('tokens', 'seeming', { targets: [2000, 0, 0], requiresSight: true }),
  ...group('tokens', 'water-breathing water-walk', {
    targets: [10, 0, 0],
    requiresWilling: true,
    preferred: 'friendly',
  }),
  ...group('tokens', 'telepathic-bond', {
    targets: [8, 0, 0],
    requiresWilling: true,
    preferred: 'friendly',
    coverageNote:
      'Check the spell Intelligence requirement and communication limitations manually.',
  }),
  ...group('tokens', 'divine-word', {
    targets: [2000, 0, 0],
    requiresSight: true,
    coverageNote:
      'Targets must hear the word. Apply saves and hit-point-dependent outcomes manually.',
  }),
  ...group('tokens', 'teleport', {
    targets: [9, 0, 0],
    requireCasterTarget: true,
    requiresWilling: true,
    durationFromSpell: false,
    coverageNote:
      'Select the caster and willing travelers. Destination, familiarity, mishaps, object transport and actual repositioning remain manual.',
  }),
  ...group('tokens', 'word-of-recall', {
    targets: [6, 0, 0],
    requireCasterTarget: true,
    requiresWilling: true,
    durationFromSpell: false,
    coverageNote:
      'Select the caster and willing travelers; the designated sanctuary and actual travel remain manual.',
  }),
  ...group('tokens', 'wind-walk', {
    targets: [11, 0, 0],
    requireCasterTarget: true,
    requiresWilling: true,
    requiresSight: true,
    preferred: 'friendly',
  }),
  'spell:alarm': area('cube', 20, { rangeFeet: 30 }),
  'spell:antilife-shell': aura(10, { excludeCaster: true, excludedTypes: ['undead', 'construct'] }),
  'spell:antimagic-field': aura(10),
  'spell:black-tentacles': area('square', 20, { requiresSight: true }),
  'spell:calm-emotions': area('sphere', 20, {
    creatureTypes: ['humanoid'],
    durationTarget: 'targets',
  }),
  'spell:circle-of-death': burst('sphere', 60),
  'spell:cloudkill': area('sphere', 20, {
    coverageNote: `${areaNote} Its automatic drift, ground-following and wind dispersal must be resolved manually.`,
  }),
  'spell:color-spray': burst('cone', 15, { rangeFeet: 0, anchor: 'caster', excludeCaster: true }),
  'spell:confusion': area('sphere', 10, { durationTarget: 'targets', radiusSlots: [10, 4, 5] }),
  'spell:control-water': area('cube', 100),
  'spell:create-or-destroy-water': burst('cube', 30, {
    coverageNote:
      'This previews the rain/fog area option. Container selection, quantity and water changes remain manual.',
  }),
  'spell:daylight': area('sphere', 60, {
    coverageNote:
      'The area previews the light radius. Object attachment and actual lighting rules remain manual.',
  }),
  'spell:delayed-blast-fireball': area('sphere', 20, {
    coverageNote: `${areaNote} Detonation timing and accumulated damage are manual; end the preview after detonation.`,
  }),
  'spell:detect-evil-and-good': aura(30),
  'spell:detect-magic': aura(30),
  'spell:detect-poison-and-disease': aura(30),
  'spell:earthquake': area('cylinder', 100, { heightFeet: 1 }),
  'spell:faerie-fire': area('cube', 20, { durationTarget: 'targets' }),
  'spell:fear': burst('cone', 30, { rangeFeet: 0, anchor: 'caster', excludeCaster: true }),
  'spell:faithful-hound': {
    kind: 'point',
    rangeFeet: 'spell',
    durationFromSpell: true,
    durationTarget: 'point',
    coverageNote:
      'Place the stationary hound marker. Detection, barking and attacks remain manual.',
  },
  'spell:flaming-sphere': area('sphere', 2.5, {
    movement: move(30, 'bonus'),
    coverageNote: `${areaNote} The sphere is 5 feet in diameter; its nearby damage zone, rolling path, barriers and pits remain manual.`,
  }),
  'spell:freezing-sphere': burst('sphere', 60, {
    coverageNote: `${areaNote} This previews immediate detonation; holding, throwing and delayed detonation require manual tracking.`,
  }),
  'spell:globe-of-invulnerability': aura(10),
  'spell:guardian-of-faith': area('sphere', 10, {
    coverageNote: `${areaNote} This shows the guardian's trigger radius; its occupied space and damage-total early ending are manual.`,
  }),
  'spell:gust-of-wind': area('line', 60, {
    rangeFeet: 0,
    anchor: 'caster',
    widthFeet: 10,
    followCaster: true,
    excludeCaster: true,
    coverageNote: `${areaNote} Changing the gust direction later uses a Bonus Action and is currently manual.`,
  }),
  'spell:hallow': area('sphere', 60),
  'spell:hallucinatory-terrain': area('cube', 150),
  'spell:holy-aura': area('sphere', 30, {
    rangeFeet: 0,
    anchor: 'caster',
    durationTarget: 'targets',
    allowExclusions: true,
    coverageNote: `${areaNote} Choose exclusions for creatures not receiving the spell when cast; their reminders follow the chosen recipients.`,
  }),
  'spell:hypnotic-pattern': area('cube', 30, { durationTarget: 'targets' }),
  'spell:incendiary-cloud': area('sphere', 20, {
    coverageNote: `${areaNote} Its later movement is manual.`,
  }),
  'spell:insect-plague': area('sphere', 20),
  'spell:magic-circle': area('cylinder', 10, { heightFeet: 20 }),
  'spell:mass-cure-wounds': burst('sphere', 30, {
    allowExclusions: true,
    maxAreaTargets: 6,
    coverageNote:
      'Exclude creatures until at most six recipients remain. Healing is not automatically applied.',
  }),
  'spell:moonbeam': area('cylinder', 5, {
    heightFeet: 40,
    movement: move(60, 'action', { laterTurnsOnly: true }),
    coverageNote: `${areaNote} Move the existing beam on later turns without casting again or spending another slot.`,
  }),
  'spell:move-earth': area('square', 40, {
    coverageNote: `${areaNote} This is a work-area reminder, not automatic terrain sculpting or repeated six-hour work schedules.`,
  }),
  'spell:pass-without-trace': aura(30),
  'spell:plant-growth': burst('cylinder', 100, {
    heightFeet: 1,
    coverageNote:
      'This previews the Overgrowth area. Plant eligibility, permanent terrain changes, exclusions and the eight-hour enrichment option remain manual.',
  }),
  'spell:prismatic-spray': burst('cone', 60, {
    rangeFeet: 0,
    anchor: 'caster',
    excludeCaster: true,
  }),
  'spell:purify-food-and-drink': burst('sphere', 5),
  'spell:reverse-gravity': area('cylinder', 50, { heightFeet: 100 }),
  'spell:silence': area('sphere', 20),
  'spell:sleet-storm': area('cylinder', 40, { heightFeet: 20 }),
  'spell:slow': area('cube', 40, {
    durationTarget: 'targets',
    allowExclusions: true,
    maxAreaTargets: 6,
    coverageNote:
      'Choose up to six recipients by excluding other creatures; resolve their saves and repeated saves manually.',
  }),
  'spell:spike-growth': area('cylinder', 20, { heightFeet: 1 }),
  'spell:stinking-cloud': area('sphere', 20),
  'spell:sunbeam': burst('line', 60, {
    rangeFeet: 0,
    anchor: 'caster',
    widthFeet: 5,
    excludeCaster: true,
    coverageNote:
      'This previews the initial beam only. The caster glow and later action-cost beams are not a persistent line; resolve later uses manually.',
  }),
  'spell:sunburst': burst('sphere', 60),
  'spell:teleportation-circle': area('cylinder', 5, { heightFeet: 1 }),
  'spell:tiny-hut': aura(10, {
    shape: 'hemisphere',
    coverageNote: `${areaNote} The dome is stationary after casting; creature/object eligibility and weather protection are manual.`,
    followCaster: false,
  }),
  'spell:web': area('cube', 20, {
    coverageNote: `${areaNote} This previews the anchored cube; flat webs are only 5 feet deep. Anchoring, collapse and burning sections are manual.`,
  }),
  'spell:weird': area('sphere', 30, { durationTarget: 'targets' }),
  'spell:zone-of-truth': area('sphere', 15),
  'spell:arcane-eye': {
    kind: 'point',
    rangeFeet: 'spell',
    durationFromSpell: true,
    durationTarget: 'point',
    movement: move(30, 'action'),
    coverageNote:
      'The marker tracks the eye, not shared vision, wall openings or sensory restrictions.',
  },
  'spell:mage-hand': {
    kind: 'point',
    rangeFeet: 'spell',
    durationFromSpell: true,
    durationTarget: 'point',
    movement: move(30, 'action', { casterRangeFeet: 30 }),
    replacePrevious: true,
    coverageNote:
      'The marker tracks the hand. Carrying, manipulation and the 10-pound limit remain manual.',
  },
  'spell:unseen-servant': {
    kind: 'point',
    rangeFeet: 'spell',
    durationFromSpell: true,
    durationTarget: 'point',
    movement: move(15, 'bonus', { casterRangeFeet: 60 }),
    coverageNote:
      'The marker tracks the servant. Commands, carrying, damage and task completion remain manual.',
  },
  'spell:silent-image': {
    kind: 'point',
    rangeFeet: 'spell',
    durationFromSpell: true,
    durationTarget: 'point',
    movement: move(120, 'action', { casterRangeFeet: 60 }),
    coverageNote:
      'The marker tracks the illusion origin, not its appearance, dimensions or investigation results.',
  },
  'spell:major-image': {
    kind: 'point',
    rangeFeet: 'spell',
    durationFromSpell: true,
    durationTarget: 'point',
    manualUpcastDuration: true,
    manualFromSlot: 6,
    upcastReason:
      'A level 6 or higher Major Image can last until dispelled without concentration. Permanent illusion placement and concentration correction remain manual.',
    movement: move(240, 'action', { casterRangeFeet: 120 }),
    coverageNote:
      'The marker tracks the illusion origin. Senses, investigation and permanent higher-slot duration require manual adjudication.',
  },
  'spell:animate-objects': manual(
    'Animate Objects needs object selection and size-dependent control budgets; use manual targeting until object-token controls are available.'
  ),
  'spell:arcane-hand': manual(
    'Arcane Hand needs a movable construct plus distinct attack, grasp, push and interpose choices; its combined commands remain manual.'
  ),
  'spell:arcane-sword': manual(
    'Arcane Sword needs a movable attack origin and a combined move/attack Bonus Action; use manual targeting for now.'
  ),
  'spell:chain-lightning': manual(
    'Choose a primary target, then secondary targets measured from the primary rather than the caster. This chained targeting mode is not implemented yet.'
  ),
  'spell:dancing-lights': manual(
    'Four independently movable light locations and their spacing need multi-point controls; their placement and movement remain manual.'
  ),
  'spell:fire-storm': manual(
    'Fire Storm needs up to ten connected cubes. A single cube would misrepresent its selectable area; connected multi-area placement remains manual.'
  ),
  'spell:forbiddance': manual(
    'Forbiddance follows up to 40,000 square feet of floor space. Arbitrary floor-plan selection and its height are not represented by one simple template.'
  ),
  'spell:gate': manual(
    'Gate needs a vertical portal and a destination on another plane. Portal orientation and off-board destinations remain manual.'
  ),
  'spell:glyph-of-warding': manual(
    'Choose a surface/object and either an explosive glyph or a stored spell. Conditional triggers and the stored spell targeting remain manual.'
  ),
  'spell:guards-and-wards': manual(
    'Guards and Wards needs a multi-room floor plan and several independently placed effects; use manual placement for now.'
  ),
  'spell:meteor-swarm': manual(
    'Meteor Swarm needs four separately placed blast origins; multi-area placement remains manual.'
  ),
  'spell:mirage-arcane': manual(
    'Mirage Arcane needs a square-mile terrain illusion rather than one combat template. Terrain changes remain manual.'
  ),
  'spell:spiritual-weapon': manual(
    'Spiritual Weapon needs its own movable attack origin and a combined move/attack Bonus Action; targeting that attack remains manual.'
  ),
  'spell:symbol': manual(
    'Symbol needs an object/surface, a chosen symbol effect and a conditional trigger. Its trigger radius and triggered effect remain manual.'
  ),
  'spell:wish': manual(
    'Wish must first choose a duplicated spell or a bespoke effect. Use the duplicated spell targeting or resolve the chosen effect manually.'
  ),
};

const sightCore = {
  ...CORE,
  ...configure(CORE, 'light minor-illusion simulacrum', { replacePrevious: true }),
  ...configure(CORE, sightTargets, { requiresSight: true }),
  ...configure(CORE, sightLocations, { requiresSight: true }),
};
const requiredCore = {
  ...sightCore,
  ...configure(sightCore, willingTargets, { requiresWilling: true, preferred: 'friendly' }),
};

export const CORE_SPELL_PROFILES_2014 = Object.freeze({
  ...requiredCore,
  ...configure(
    requiredCore,
    'blindness-deafness poison-spray prayer-of-healing water-breathing water-walk wind-walk',
    {
      requiresSight: true,
    }
  ),
  ...configure(
    requiredCore,
    'heal mass-heal mass-healing-word prayer-of-healing mass-cure-wounds',
    {
      excludedTypes: ['undead', 'construct'],
    }
  ),
  'spell:guiding-bolt': { ...CORE['spell:guiding-bolt'], requiresSight: false, expiry: 'end' },
  'spell:chill-touch': { ...CORE['spell:chill-touch'], durationFromSpell: true },
  'spell:feeblemind': { kind: 'tokens', rangeFeet: 'spell', requiresSight: true },
  'spell:true-strike': {
    kind: 'tokens',
    rangeFeet: 'spell',
    durationFromSpell: true,
    durationTarget: 'caster',
    expiry: 'end',
  },
  'spell:hold-monster': { ...CORE['spell:hold-monster'], excludedTypes: ['undead'] },
  'spell:foresight': { ...CORE['spell:foresight'], requiresWilling: true },
});

const revisedCore = Object.fromEntries(
  Object.entries(requiredCore).filter(
    ([id]) =>
      ![
        'spell:antipathy-sympathy',
        'spell:blindness-deafness',
        'spell:branding-smite',
        'spell:enlarge-reduce',
      ].includes(id)
  )
);

export const CORE_SPELL_PROFILES_2024 = Object.freeze({
  ...revisedCore,
  ...configure(
    revisedCore,
    'fabricate find-familiar giant-insect magic-jar magic-mouth project-image',
    {
      requiresSight: true,
    }
  ),
  'spell:jump': { ...CORE['spell:jump'], requiresWilling: true },
  'spell:guiding-bolt': { ...CORE['spell:guiding-bolt'], requiresSight: false, expiry: 'end' },
  'spell:major-image': {
    ...requiredCore['spell:major-image'],
    manualFromSlot: 4,
    upcastReason:
      'A level 4 or higher 2024 Major Image can last until dispelled without concentration. Permanent illusion placement and concentration correction remain manual.',
  },
  'spell:warding-bond': { ...CORE['spell:warding-bond'], excludeSelf: true },
  ...group(
    'tokens',
    `befuddlement blindnessdeafness charm-monster dissonant-whispers mind-spike
    phantasmal-force power-word-heal`,
    { requiresSight: true }
  ),
  ...group('tokens', 'ray-of-sickness starry-wisp'),
  ...group('tokens', 'blindnessdeafness', { targets: [1, 2, 1], requiresSight: true }),
  ...group('tokens', 'charm-monster', { targets: [1, 4, 1], requiresSight: true }),
  ...group('tokens', 'dragons-breath', {
    requiresWilling: true,
    coverageNote:
      'This tracks the willing recipient. Its granted 15-foot cone Magic action and repeated damage are manual.',
  }),
  ...group('self', `divine-smite ensnaring-strike searing-smite shining-smite`, {
    coverageNote:
      'This follows the caster as a reminder. Confirm the triggering hit and resolve extra damage, saves and target conditions manually.',
  }),
  ...group('point', 'antipathysympathy elementalism', { coverageNote: pointNote }),
  ...group('tokens', 'sorcerous-burst'),
  ...group('point', 'summon-dragon', { coverageNote: summonNote }),
  ...group('self', 'heroes-feast shillelagh goodberry'),
  'spell:prayer-of-healing': {
    ...CORE['spell:prayer-of-healing'],
    targets: [5, 0, 0],
    requiresWilling: true,
    requiresSight: false,
  },
  'spell:spare-the-dying': {
    ...CORE['spell:spare-the-dying'],
    rangeDoubleLevels: [5, 11, 17],
  },
  'spell:tsunami': manual(
    'Tsunami is a moving, shrinking wall with per-round geometry changes. Its placement, drift and shrinking height remain manual until staged-area controls are available.'
  ),
  'spell:enlargereduce': manual(
    'Enlarge/Reduce can target a creature or an object. Choose and adjudicate the eligible target manually until mixed target controls are available.'
  ),
  'spell:hex': {
    kind: 'tokens',
    rangeFeet: 'spell',
    durationFromSpell: true,
    durationTarget: 'targets',
    requiresSight: true,
    coverageNote:
      'Extra damage, chosen ability and transferring the curse to a later target remain manual.',
  },
  'spell:chromatic-orb': manual(
    'Chromatic Orb needs a chosen damage type and conditional, rolled-damage-dependent leaps. Resolve its chained targets manually for now.'
  ),
  'spell:ice-knife': manual(
    'Ice Knife combines one attack target with an explosion around that target. The mixed attack/area selection remains manual.'
  ),
  'spell:true-strike': manual(
    '2024 True Strike makes an attack with the weapon used to cast it. Choose the weapon and resolve that weapon-specific attack manually.'
  ),
  'spell:aura-of-life': aura(30, { shape: 'emanation' }),
  'spell:vitriolic-sphere': burst('sphere', 20),
  'spell:chill-touch': {
    ...requiredCore['spell:chill-touch'],
    meleeAttack: true,
    durationFromSpell: false,
    lingerTurns: 1,
    expiry: 'end',
    durationLabel: 'Until the end of the next caster turn',
  },
  'spell:shocking-grasp': { ...requiredCore['spell:shocking-grasp'], meleeAttack: true },
  'spell:holy-aura': aura(30, {
    shape: 'emanation',
    allowExclusions: true,
    coverageNote: `${areaNote} Choose which creatures receive the aura; eligibility of creatures entering later is manual.`,
  }),
  'spell:mass-cure-wounds': {
    ...CORE['spell:mass-cure-wounds'],
    requiresSight: true,
    areaTargetsRequireSight: true,
  },
  'spell:sleet-storm': area('cylinder', 20, { heightFeet: 40 }),
  'spell:call-lightning': {
    ...CORE['spell:call-lightning'],
    defaultElevationFeet: 10,
    minOriginHeightFeet: 1,
  },
  'spell:conjure-celestial': area('cylinder', 10, {
    heightFeet: 40,
    coverageNote: `${areaNote} Choose healing or searing light per creature manually. Moving with the caster's movement is not automated.`,
  }),
  'spell:conjure-animals': {
    kind: 'point',
    rangeFeet: 'spell',
    durationFromSpell: true,
    durationTarget: 'point',
    requiresSight: true,
    coverageNote:
      'Place the Large spectral pack marker. Its ten-foot proximity area, saves and movement with the caster remain manual; this does not summon individual beast stat blocks.',
  },
  'spell:conjure-fey': {
    kind: 'point',
    rangeFeet: 'spell',
    durationFromSpell: true,
    durationTarget: 'point',
    requiresSight: true,
    coverageNote:
      'Place the Medium spirit marker. Its initial attack and later combined Bonus Action teleport/attack remain manual.',
  },
  'spell:conjure-elemental': {
    kind: 'point',
    rangeFeet: 'spell',
    durationFromSpell: true,
    durationTarget: 'point',
    coverageNote:
      'Place the Large spirit marker. Element choice, occupied space, nearby saves and the one-restrained-creature limit remain manual.',
  },
  'spell:conjure-minor-elementals': aura(15, { shape: 'emanation', excludeCaster: true }),
  'spell:conjure-woodland-beings': aura(10, { shape: 'emanation', excludeCaster: true }),
  'spell:moonbeam': {
    ...CORE['spell:moonbeam'],
    movement: move(60, 'action', { magicAction: true, laterTurnsOnly: true }),
  },
  'spell:arcane-eye': {
    ...CORE['spell:arcane-eye'],
    movement: move(30, 'action', { magicAction: true }),
  },
  'spell:mage-hand': {
    ...CORE['spell:mage-hand'],
    movement: move(30, 'action', { casterRangeFeet: 30, magicAction: true }),
  },
});
