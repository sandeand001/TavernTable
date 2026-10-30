const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const {
  normalizeEquipment2024,
  normalizeOpen5e,
  sanitizeLegacySpells,
} = require('./resource-import.js');

const ROOT = path.resolve(__dirname, '..');
const REVISION = 1;
const OPEN5E = 'e69ac13b49dae6a9d84abf38fc674fe1db5b392b';
const SRD2024 = 'ee9e3fdfa6de7563efbc8878bce3d9b6dba920b1';
const SRD2014 = '386930c2e93a7f2c9ba2a9715ccc5b95d8926e41';
const PACKS = [
  ['wizards-of-the-coast', 'srd-2014', '2014', 'wotc-srd'],
  ['wizards-of-the-coast', 'srd-2024', '2024', null],
  ['green-ronin', 'tdcs', '2014', 'taldorei'],
  ['kobold-press', 'ccdx', '2014', 'cc'],
  ['kobold-press', 'deepm', '2014', 'dmag'],
  ['kobold-press', 'deepmx', '2014', 'dmag-e'],
  ['kobold-press', 'kp', '2014', 'kp'],
  ['kobold-press', 'tob', '2014', 'tob'],
  ['kobold-press', 'tob-2023', '2014', 'tob-2023'],
  ['kobold-press', 'tob2', '2014', 'tob2'],
  ['kobold-press', 'tob3', '2014', 'tob3'],
  ['kobold-press', 'toh', '2014', 'toh'],
  ['kobold-press', 'vom', '2014', 'vom'],
  ['kobold-press', 'wz', '2014', 'warlock'],
  ['open5e', 'open5e', '2014', 'o5e'],
  ['somanyrobots', 'spells-that-dont-suck', '2014', null],
];
const ABILITIES = {
  str: 'strength',
  dex: 'dexterity',
  con: 'constitution',
  int: 'intelligence',
  wis: 'wisdom',
  cha: 'charisma',
};
const EFFECTS2024 = {
  'ring-of-protection': { ac: 1, saves: 1 },
  'cloak-of-protection': { ac: 1, saves: 1 },
  'gauntlets-of-ogre-power': { abilityMinimum: { strength: 19 } },
  'headband-of-intellect': { abilityMinimum: { intelligence: 19 } },
  'bracers-of-defense': { ac: 2, unarmoredOnly: true },
};
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const git = (directory, args) =>
  execFileSync('git', ['-c', 'core.pager=cat', '-C', directory, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
    maxBuffer: 16000000,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  });

async function sourceDirectory(provided, name, repository, commit, directories) {
  const directory = provided
    ? path.resolve(provided)
    : path.join(os.tmpdir(), `taverntable-resource-source-${name}-${commit}`);
  const exists = await fs.stat(directory).then(
    () => true,
    (error) => {
      if (error.code === 'ENOENT') return false;
      throw error;
    }
  );
  if (!exists) {
    if (provided) throw new Error(`Source repository does not exist: ${directory}`);
    execFileSync(
      'git',
      ['clone', '--depth', '1', '--filter=blob:none', '--sparse', repository, directory],
      {
        stdio: 'inherit',
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      }
    );
    if (git(directory, ['rev-parse', 'HEAD']).trim() !== commit) {
      git(directory, ['fetch', '--depth', '1', 'origin', commit]);
      git(directory, ['checkout', '--detach', commit]);
    }
    git(directory, ['sparse-checkout', 'set', ...directories]);
  }
  if (
    git(directory, ['rev-parse', 'HEAD']).trim() !== commit ||
    git(directory, ['status', '--porcelain', '--untracked-files=all']).trim()
  ) {
    throw new Error(`Source repository must be clean and pinned to ${commit}: ${directory}`);
  }
  return directory;
}

async function jsonFile(file) {
  const bytes = await fs.readFile(file);
  return { data: JSON.parse(bytes.toString('utf8')), hash: hash(bytes) };
}

async function collectionDirectory(directory) {
  const collections = {};
  const files = [];
  for (const file of (await fs.readdir(directory))
    .filter((file) => file.endsWith('.json'))
    .sort()) {
    const result = await jsonFile(path.join(directory, file));
    if (!Array.isArray(result.data)) throw new Error(`Invalid source collection: ${file}`);
    collections[file.slice(0, -5)] = result.data;
    files.push({ name: file, hash: result.hash, count: result.data.length });
  }
  return { collections, files };
}

function enhancedEquipment(entries) {
  return entries
    .filter((entry) => ['weapon', 'armor', 'shield'].includes(entry.equipmentType))
    .flatMap((entry) =>
      [1, 2, 3].map((bonus) => ({
        ...entry,
        id: `enhanced:${entry.sourceIndex}:${bonus}`,
        name: `${entry.name} +${bonus}`,
        category: 'Magic item',
        bonus,
        cost: '',
        armor: entry.armor ? { ...entry.armor, base: entry.armor.base + bonus } : null,
        description: [
          ...entry.description,
          entry.weapon
            ? `Magic weapon: +${bonus} to attack and damage rolls while equipped.`
            : `Magic armor/shield: +${bonus} AC enhancement is included while equipped.`,
        ],
      }))
    );
}

function classes2024(source, equipment) {
  const weaponReferences = new Map(
    source.Proficiencies.filter((row) => row.reference?.url?.includes('/equipment/')).map((row) => [
      row.index,
      `weapon:${row.reference.index}`,
    ])
  );
  return source.Classes.map((raw) => {
    const levels = source.Levels.filter((row) => row.class.index === raw.index && !row.subclass);
    if (levels.length !== 20) throw new Error(`Incomplete 2024 class progression: ${raw.index}`);
    let proficiencies = raw.proficiencies.map(
      (row) => weaponReferences.get(row.index) || row.index
    );
    if (['monk', 'rogue'].includes(raw.index)) {
      const specific = new Set(weaponReferences.values());
      proficiencies = proficiencies.filter((id) => !specific.has(id));
      for (const entry of equipment.filter((entry) => entry.weapon?.category === 'martial')) {
        const properties = entry.weapon.properties;
        if (
          properties.includes('light') ||
          (raw.index === 'rogue' && properties.includes('finesse'))
        ) {
          proficiencies.push(entry.weapon.proficiency);
        }
      }
    }
    return {
      id: raw.index,
      name: raw.name,
      hitDie: raw.hit_die,
      saves: raw.saving_throws.map((row) => ABILITIES[row.index]),
      proficiencies: [...new Set(proficiencies)],
      castingAbility: ABILITIES[raw.spellcasting?.spellcasting_ability?.index] || '',
      prepared: Object.fromEntries(
        levels.map((row) => [row.level, row.spellcasting?.prepared_spells ?? 0])
      ),
      slots: Object.fromEntries(
        levels.map((row) => [
          row.level,
          Array.from(
            { length: 9 },
            (_, i) => row.spellcasting?.[`spell_slots_level_${i + 1}`] || 0
          ),
        ])
      ),
    };
  });
}

async function main(args = process.argv.slice(2)) {
  const option = (name) => {
    const at = args.indexOf(name);
    if (at < 0) return undefined;
    if (!args[at + 1] || args[at + 1].startsWith('--'))
      throw new Error(`Missing value for ${name}`);
    return args[at + 1];
  };
  const open5e = await sourceDirectory(
    option('--open5e'),
    'open5e',
    'https://github.com/open5e/open5e-api.git',
    OPEN5E,
    ['data/v2', 'data/raw_sources/srd_5_2/sections']
  );
  const bits = await sourceDirectory(
    option('--srd2024'),
    '5e-bits',
    'https://github.com/5e-bits/5e-srd-api.git',
    SRD2024,
    ['packages/5e-database/src/2024/en']
  );
  const legacy = await jsonFile(path.join(ROOT, 'assets', 'data', 'srd2014.json'));
  if (legacy.data.provenance.commit !== SRD2014)
    throw new Error('The 2014 base snapshot has an unexpected source pin');
  const source = {};
  const bitsFiles = [];
  for (const name of [
    'Classes',
    'Levels',
    'Equipment',
    'Proficiencies',
    'Subclasses',
    'Weapon-Mastery-Properties',
  ]) {
    const file = `5e-SRD-${name}.json`;
    const result = await jsonFile(
      path.join(bits, 'packages', '5e-database', 'src', '2024', 'en', file)
    );
    source[name] = result.data;
    bitsFiles.push({ name: file, hash: result.hash, count: result.data.length });
  }
  const equipment = source.Equipment.map(normalizeEquipment2024);
  const classes = classes2024(source, equipment);
  const providerLicense = await fs.readFile(path.join(open5e, 'LICENSE.md'), 'utf8');
  const databaseLicense = await fs.readFile(
    path.join(bits, 'packages', '5e-database', 'LICENSE.md'),
    'utf8'
  );
  const licenseRows = (await jsonFile(path.join(open5e, 'data', 'v2', 'License.json'))).data;
  const licenses = new Map(licenseRows.map((row) => [row.pk, { ...row.fields, id: row.pk }]));
  const notices = new Map();
  for (const directory of new Set(PACKS.map((row) => row[3]).filter(Boolean))) {
    const rows = JSON.parse(git(open5e, ['show', `${OPEN5E}:data/v1/${directory}/Document.json`]));
    notices.set(
      directory,
      rows
        .map((row) => row.fields.copyright)
        .filter(Boolean)
        .join('\n')
    );
  }
  const combinedNotices = [...new Set(notices.values())].join('\n\n');
  const output = path.join(ROOT, 'assets', 'data', 'resources');
  await fs.mkdir(output, { recursive: true });
  const manifest = {
    version: 1,
    packs: [],
    excludedPacks: [
      {
        id: 'open5e-2024',
        reason:
          'The provider fixtures still declare the 2014 Open5e document; they are not validated 2024 content.',
      },
    ],
  };
  const contentNotices = [];
  for (const [publisher, id, ruleset, notice] of PACKS) {
    const { collections, files } = await collectionDirectory(
      path.join(open5e, 'data', 'v2', publisher, id)
    );
    const document = collections.Document?.find((row) => row.pk === id)?.fields;
    if (!document || document.gamesystem !== `5e-${ruleset}`) {
      throw new Error(`Incompatible or missing source document: ${id}`);
    }
    const core = id === `srd-${ruleset}`;
    const srd = ruleset === '2014' ? '5.1' : '5.2.1';
    const version = core ? `${srd}-seed.${REVISION}` : `seed.${REVISION}`;
    const normalized = normalizeOpen5e({ documentId: id, ruleset, core, collections });
    let entries = normalized;
    if (id === 'srd-2014') {
      entries = [
        ...sanitizeLegacySpells(legacy.data.entries),
        ...normalized.filter((entry) => !['item', 'spell'].includes(entry.kind)),
      ].map((entry) => ({ ...entry, ruleset }));
    } else if (id === 'srd-2024') {
      const magic = normalized
        .filter((entry) => entry.sourceCollection === 'MagicItem')
        .map((entry) => {
          const effects = EFFECTS2024[entry.sourceIndex.slice(id.length + 1)];
          return effects
            ? { ...entry, effects, automation: 'effects', automationNotes: [] }
            : entry;
        });
      entries = [
        ...equipment,
        ...enhancedEquipment(equipment),
        ...magic,
        ...normalized.filter((entry) => entry.kind !== 'item'),
      ];
      for (const [collection, kind] of [
        ['Subclasses', 'subclass'],
        ['Weapon-Mastery-Properties', 'property'],
      ]) {
        for (const raw of source[collection]) {
          if (
            entries.some(
              (entry) => entry.kind === kind && entry.name.toLowerCase() === raw.name.toLowerCase()
            )
          )
            continue;
          const description = raw.description || raw.desc || [];
          entries.push({
            id: `reference:srd-2024:${kind}:${raw.index}`,
            kind,
            ruleset,
            name: raw.name,
            category: kind === 'property' ? 'Weapon Mastery' : 'Subclass',
            description: Array.isArray(description) ? description : [description],
            automation: 'reference',
            automationNotes: ['Reference only; eligibility and effects are manual.'],
            sourceIndex: raw.index,
            sourceCollection: `5eAPI.${collection}`,
          });
        }
      }
    }
    if (!entries.length || new Set(entries.map((entry) => entry.id)).size !== entries.length) {
      throw new Error(`Empty source pack or duplicate normalized identifiers: ${id}`);
    }
    entries.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const licenseIds = document.licenses.includes('cc-by-40') ? ['cc-by-40'] : document.licenses;
    if (
      !licenseIds.length ||
      licenseIds.some((key) => !licenses.has(key)) ||
      (licenseIds.includes('ogl-10a') && !notice)
    ) {
      throw new Error(`Missing redistributable license or copyright notice: ${id}`);
    }
    const attribution = core
      ? ruleset === '2014'
        ? await fs.readFile(path.join(ROOT, 'assets', 'data', 'SRD2014-NOTICE.txt'), 'utf8')
        : 'This work includes material from the System Reference Document 5.2 ("SRD 5.2") by Wizards of the Coast LLC, available at https://www.dndbeyond.com/srd. The SRD 5.2 is licensed under the Creative Commons Attribution 4.0 International License, available at https://creativecommons.org/licenses/by/4.0/legalcode.'
      : `${document.name}. ${notices.get(notice) || `By ${document.author}. ${document.permalink}`}`;
    const pack = {
      version,
      schemaVersion: 1,
      id,
      name: core ? `SRD ${srd}` : document.name,
      ruleset,
      core,
      classes: core ? (ruleset === '2014' ? legacy.data.classes : classes) : [],
      entries,
      provenance: {
        attribution,
        document: { id, ...document },
        provider: 'Open5e',
        repository: 'https://github.com/open5e/open5e-api',
        commit: OPEN5E,
        files,
        providerLicense,
        licenses: licenseIds.map((key) => ({
          ...licenses.get(key),
          ...(key === 'ogl-10a' ? { copyrightNotices: combinedNotices } : {}),
        })),
        modifications:
          'Normalized and namespaced for TavernTable; images excluded. Omitted Spell flags follow api_v2/models/spell.py defaults. Only explicitly marked mechanics are automated; unsupported scaling is manual.',
        ...(licenseIds.includes('ogl-10a')
          ? {
              openGameContent:
                'The rules text and derived statistics in this source-pack JSON are designated Open Game Content. TavernTable application code, UI and unrelated assets are not designated Open Game Content.',
            }
          : {}),
        ...(core
          ? {
              target: `SRD ${srd}`,
              structuredData: {
                repository: 'https://github.com/5e-bits/5e-srd-api',
                license: databaseLicense,
                commit: ruleset === '2014' ? SRD2014 : SRD2024,
                files: ruleset === '2014' ? legacy.data.provenance.files : bitsFiles,
                ...(ruleset === '2014'
                  ? { baseSnapshotHash: legacy.hash }
                  : {
                      normalization:
                        '2024 Monk/Rogue weapon training follows SRD 5.2.1 properties, not stale provider proficiency lists.',
                    }),
              },
            }
          : {}),
      },
    };
    const bytes = Buffer.from(`${JSON.stringify(pack)}\n`);
    contentNotices.push(
      `${pack.name} (${ruleset} rules)\n${attribution}\nSource: ${document.permalink}\nLicense: ${licenseIds.join(', ')}\n${pack.provenance.openGameContent || ''}`
    );
    const filename = `${id}-${version}.json`;
    await fs.writeFile(path.join(output, filename), bytes);
    manifest.packs.push({
      id,
      version,
      name: pack.name,
      ruleset,
      core,
      file: `assets/data/resources/${filename}`,
      bytes: bytes.length,
      hash: hash(bytes),
      count: entries.length,
      licenses: licenseIds,
      author: document.author,
      sourceURL: document.permalink,
    });
    console.log(`${id}: ${entries.length} entries, ${bytes.length} bytes`);
  }
  const ogl = licenses
    .get('ogl-10a')
    .desc.replace(
      'END OF LICENSE',
      `\nAdditional Section 15 copyright notices:\n${combinedNotices}\nEND OF LICENSE`
    );
  const noticeText = [
    'TavernTable bundled resource notices',
    'These notices apply to the resource catalog JSON, not unrelated application images, models or code. No provider images are bundled.',
    ...contentNotices,
    'CREATIVE COMMONS ATTRIBUTION 4.0',
    licenses.get('cc-by-40').desc,
    'OPEN GAME LICENSE AND COPYRIGHT NOTICES',
    ogl,
    'OPEN5E SOURCE LICENSE (content exceptions retained)',
    providerLicense,
    '5E-BITS STRUCTURED DATABASE LICENSE',
    databaseLicense,
  ].join('\n\n');
  await fs.writeFile(path.join(output, 'NOTICES.txt'), `${noticeText}\n`, 'utf8');
  await fs.writeFile(path.join(output, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(
    `Generated ${manifest.packs.length} versioned offline packs. No provider calls are needed during play.`
  );
  return manifest;
}

if (require.main === module)
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });

module.exports = { main };
