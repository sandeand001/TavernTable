const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');

const REF = '386930c2e93a7f2c9ba2a9715ccc5b95d8926e41';
const ROOT = `https://raw.githubusercontent.com/5e-bits/5e-srd-api/${REF}/packages/5e-database`;
const FILES = ['Equipment', 'Magic-Items', 'Spells', 'Classes', 'Levels', 'Proficiencies'];
const ABILITIES = {
  str: 'strength',
  dex: 'dexterity',
  con: 'constitution',
  int: 'intelligence',
  wis: 'wisdom',
  cha: 'charisma',
};
const EFFECTS = {
  'ring-of-protection': { ac: 1, saves: 1 },
  'cloak-of-protection': { ac: 1, saves: 1 },
  'gauntlets-of-ogre-power': { abilityMinimum: { strength: 19 } },
  'headband-of-intellect': { abilityMinimum: { intelligence: 19 } },
  'bracers-of-defense': { ac: 2, unarmoredOnly: true },
};

async function download(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`SRD download failed (${response.status}): ${url}`);
  return response.text();
}

function equipment(raw) {
  const type =
    raw.armor_category === 'Shield'
      ? 'shield'
      : raw.armor_class
        ? 'armor'
        : raw.damage
          ? 'weapon'
          : 'gear';
  return {
    id: `item:${raw.index}`,
    kind: 'item',
    name: raw.name,
    category: raw.equipment_category?.name || 'Equipment',
    description: raw.desc || [],
    equipmentType: type,
    weight: raw.weight ?? null,
    cost: raw.cost ? `${raw.cost.quantity} ${raw.cost.unit}` : '',
    armor: raw.armor_class
      ? {
          base: raw.armor_class.base,
          dexterity: raw.armor_class.dex_bonus,
          ...(raw.armor_class.max_bonus != null ? { maxDexterity: raw.armor_class.max_bonus } : {}),
          category: raw.armor_category,
          strengthMinimum: raw.str_minimum || 0,
          stealthDisadvantage: !!raw.stealth_disadvantage,
        }
      : null,
    weapon: raw.damage
      ? {
          category: raw.weapon_category.toLowerCase(),
          range: raw.weapon_range.toLowerCase(),
          damage: raw.damage.damage_dice,
          damageType: raw.damage.damage_type.name,
          versatile: raw.two_handed_damage?.damage_dice || '',
          properties: (raw.properties || []).map((property) => property.index),
          distance: raw.range,
        }
      : null,
    bonus: 0,
    requiresAttunement: false,
    effects: {},
    automation: ['weapon', 'armor', 'shield'].includes(type) ? 'equipment' : 'reference',
    sourceIndex: raw.index,
  };
}

function magicItem(raw) {
  const description = raw.desc || [];
  return {
    id: `magic:${raw.index}`,
    kind: 'item',
    name: raw.name,
    category: 'Magic item',
    description,
    equipmentType: 'magic',
    weight: null,
    rarity: raw.rarity?.name || '',
    requiresAttunement: description.some((text) => /requires attunement/i.test(text)),
    effects: EFFECTS[raw.index] || {},
    bonus: 0,
    automation: EFFECTS[raw.index] ? 'effects' : 'reference',
    sourceIndex: raw.index,
  };
}

function spell(raw) {
  return {
    id: `spell:${raw.index}`,
    kind: 'spell',
    name: raw.name,
    category: 'Spell',
    description: [
      ...(raw.desc || []),
      ...(raw.higher_level || []).map((text) => `At higher levels: ${text}`),
    ],
    level: raw.level,
    school: raw.school.name,
    classes: raw.classes.map((entry) => entry.index),
    castingTime: raw.casting_time,
    range: raw.range,
    duration: raw.duration,
    components: (raw.components || []).join(', '),
    material: raw.material || '',
    concentration: !!raw.concentration,
    ritual: !!raw.ritual,
    attackType: raw.attack_type || '',
    saveAbility: ABILITIES[raw.dc?.dc_type?.index] || '',
    saveSuccess: raw.dc?.dc_success || '',
    damage: Array.isArray(raw.damage) ? raw.damage : raw.damage ? [raw.damage] : [],
    healing: raw.heal_at_slot_level || null,
    automation: 'spellcasting',
    sourceIndex: raw.index,
  };
}

async function main() {
  const sources = await Promise.all(
    FILES.map(async (name) => {
      const url = `${ROOT}/src/2014/en/5e-SRD-${name}.json`;
      const text = await download(url);
      const records = JSON.parse(text);
      if (!Array.isArray(records) || !records.length)
        throw new Error(`Empty SRD collection: ${name}`);
      return { name, url, records, sha256: createHash('sha256').update(text).digest('hex') };
    })
  );
  const source = Object.fromEntries(sources.map((entry) => [entry.name, entry.records]));
  const mundane = source.Equipment.map(equipment);
  for (const entry of mundane.filter((item) => item.weapon)) {
    const proficiency = source.Proficiencies.find(
      (record) => record.reference?.index === entry.sourceIndex
    );
    if (!proficiency) throw new Error(`Missing weapon proficiency: ${entry.name}`);
    entry.weapon.proficiency = proficiency.index;
  }
  const enhanced = [];
  for (const entry of mundane.filter((item) =>
    ['weapon', 'armor', 'shield'].includes(item.equipmentType)
  )) {
    for (const bonus of [1, 2, 3]) {
      enhanced.push({
        ...entry,
        id: `enhanced:${entry.sourceIndex}:${bonus}`,
        name: `${entry.name} +${bonus}`,
        category: 'Magic item',
        bonus,
        armor: entry.armor ? { ...entry.armor, base: entry.armor.base + bonus } : null,
        description: [
          ...entry.description,
          entry.weapon
            ? `SRD magic weapon: +${bonus} to attack and damage rolls while equipped.`
            : `SRD magic armor/shield: +${bonus} AC enhancement included while equipped.`,
        ],
        cost: '',
        sourceIndex: `${entry.equipmentType === 'weapon' ? 'weapon' : entry.equipmentType === 'shield' ? 'shield' : 'armor'}-${bonus}`,
      });
    }
  }
  const entries = [
    ...mundane,
    ...enhanced,
    ...source['Magic-Items'].map(magicItem),
    ...source.Spells.map(spell),
  ].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  if (new Set(entries.map((entry) => entry.id)).size !== entries.length) {
    throw new Error('Duplicate compendium identifiers');
  }
  const classes = source.Classes.map((entry) => ({
    id: entry.index,
    name: entry.name,
    hitDie: entry.hit_die,
    saves: entry.saving_throws.map((ability) => ABILITIES[ability.index]),
    proficiencies: entry.proficiencies.map((proficiency) => proficiency.index),
    castingAbility: ABILITIES[entry.spellcasting?.spellcasting_ability?.index] || '',
    slots: Object.fromEntries(
      source.Levels.filter((level) => level.class.index === entry.index && !level.subclass).map(
        (level) => [
          level.level,
          Array.from(
            { length: 9 },
            (_, i) => level.spellcasting?.[`spell_slots_level_${i + 1}`] || 0
          ),
        ]
      )
    ),
  }));
  const output = {
    version: 1,
    rules: 'D&D 2014 / SRD 5.1',
    provenance: {
      repository: 'https://github.com/5e-bits/5e-srd-api',
      commit: REF,
      files: sources.map(({ name, url, sha256, records }) => ({
        name,
        url,
        sha256,
        count: records.length,
      })),
      attribution:
        'Rules material: SRD 5.1 by Wizards of the Coast LLC, CC BY 4.0. Structured data: 5e-bits, MIT. See SRD2014-NOTICE.txt.',
    },
    classes,
    entries,
  };
  const license = await download(`${ROOT}/LICENSE.md`);
  const directory = path.resolve(__dirname, '..', 'assets', 'data');
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, 'srd2014.json'), `${JSON.stringify(output)}\n`, 'utf8');
  await fs.writeFile(path.join(directory, 'SRD2014-UPSTREAM-LICENSE.txt'), license, 'utf8');
  console.log(`Generated ${entries.length} entries and ${classes.length} classes from ${REF}.`);
  console.log(JSON.stringify(output.provenance.files.map(({ name, count }) => ({ name, count }))));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
