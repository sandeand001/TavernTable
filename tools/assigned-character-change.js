const { isDeepStrictEqual } = require('node:util');
const {
  default: CampaignCharacters,
  campaignRecordCharacterId,
  validateCampaignCharacters,
} = require('../src/campaigns/CampaignCharacters.js');
const { decodeScene } = require('../src/campaigns/CampaignScene.js');

const reject = (message) => Object.assign(new Error(message), { status: 403 });

function prepareAssignedCharacterChange({ state, library: previousLibrary, characterIds, change }) {
  if (!change || Object.hasOwn(change, 'scene'))
    throw reject('Player world and combat commands are not enabled in this milestone');
  if (change.ruleset !== state.campaign.ruleset)
    throw reject('The character changes belong to another ruleset');
  if (change.revision !== state.revision)
    throw Object.assign(
      new Error('Campaign data changed in another window. Refresh the assigned sheets and retry.'),
      { status: 409 }
    );
  if (
    !Array.isArray(change.records) ||
    change.records.some(
      (row) => !row || typeof row.key !== 'string' || typeof row.value !== 'string'
    )
  )
    throw new Error('Invalid character records');
  const owned = new Set(characterIds);
  if (change.records.some((row) => !owned.has(campaignRecordCharacterId(row.key))))
    throw reject('Players can edit only their assigned saved characters');
  for (const row of state.records)
    if (
      row.key.startsWith('taverntable.character.v1.') &&
      owned.has(campaignRecordCharacterId(row.key)) &&
      !change.records.some((next) => next.key === row.key)
    )
      throw reject('Players cannot delete assigned saved characters');
  const records = [
    ...state.records.filter((row) => !owned.has(campaignRecordCharacterId(row.key))),
    ...change.records,
  ];
  const catalog = previousLibrary.sourceCatalog;
  validateCampaignCharacters(state.campaign, catalog, records);
  const library = new CampaignCharacters({ ...state, records, catalog });
  const enabled = new Set(catalog.enabledEntryIds);
  for (const row of change.records.filter((entry) =>
    entry.key.startsWith('taverntable.character.v1.')
  )) {
    const id = campaignRecordCharacterId(row.key);
    const before = previousLibrary.get(id);
    const after = library.get(id);
    for (const field of ['conditions', 'fallTraits', 'concentration'])
      if (
        !isDeepStrictEqual(
          field === 'conditions' ? [...before.conditions].sort() : before[field],
          field === 'conditions' ? [...after.conditions].sort() : after[field]
        )
      )
        throw reject(
          'World conditions, flight protection and concentration require DM adjudication until player gameplay commands are enabled'
        );
    const oldEntries = new Map(
      [...(before.equipment || []), ...(before.spells || [])].map((entry) => [
        entry.id,
        entry.entryId,
      ])
    );
    for (const entry of [...after.equipment, ...after.spells])
      if (oldEntries.get(entry.id) !== entry.entryId && !enabled.has(entry.entryId))
        throw reject('Ask the DM to enable this source before adding new content');
  }
  let changedScene;
  if (state.scene) {
    const scene = JSON.parse(state.scene);
    for (const creature of scene.creatures)
      if (owned.has(creature.characterId)) creature.name = library.get(creature.characterId).name;
    const serialized = JSON.stringify(scene);
    decodeScene(serialized, { ruleset: state.campaign.ruleset, library });
    if (serialized !== state.scene)
      changedScene = { revision: state.sceneRevision, value: serialized };
  }
  return {
    ruleset: change.ruleset,
    revision: change.revision,
    records,
    ...(changedScene ? { scene: changedScene } : {}),
  };
}

module.exports = { prepareAssignedCharacterChange };
