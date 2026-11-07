import { webcrypto } from 'node:crypto';
import { TextDecoder } from 'node:util';
import CampaignWorkspace from '../../../src/campaigns/CampaignWorkspace.js';
import CampaignAutosave from '../../../src/campaigns/CampaignAutosave.js';
import { placeSavedCharacter } from '../../../src/campaigns/SavedCharacterPlacement.js';
import { getTokenCharacter } from '../../../src/ui/characters/characterServices.js';
import { SavedCharacterSheets } from '../../../src/ui/sessions/PlayerCharacterSheets.js';
import { InputCoordinator } from '../../../src/coordinators/InputCoordinator.js';
import { InteractionManager } from '../../../src/managers/InteractionManager.js';
import { fetchBundledResource } from '../../helpers/bundledResources.js';
import { testIndexedDB } from '../../helpers/indexedDB.js';
import { createCampaignBoard } from '../../helpers/campaignBoard.js';
import { sceneState } from '../../helpers/sceneState.js';

globalThis.TextDecoder ??= TextDecoder;

let workspace;
let services;
let gm;
let autosave;
let characterId;

beforeEach(async () => {
  workspace = await CampaignWorkspace.load({
    storage: 'browser',
    fetch: fetchBundledResource,
    indexedDB: testIndexedDB(),
    crypto: webcrypto,
  });
  const campaign = await workspace.create({ name: 'Saved roster', ruleset: '2024' });
  services = await workspace.open(campaign.id);
  characterId = await services.library.create('Existing hero');
  await services.library.edit(characterId, {
    classId: 'wizard',
    level: 5,
    hp: { current: 4, temp: 3 },
    slotsUsed: [1, 0, 0, 0, 0, 0, 0, 0, 0],
    notes: 'Keep my character state',
    portraitImage: 'data:image/png;base64,iVBORw0KGgo=',
    artworkImage: 'data:image/jpeg;base64,/9j/',
  });
  const owned = await services.library.add(characterId, 'spell:mage-hand');
  await services.library.prepare(characterId, owned, true);
  await services.library.layouts.savePage(characterId, 'combat', {
    sectionOrder: ['favorites'],
    cardOrder: {},
    favorites: [`spell:${owned}`],
  });
  gm = createCampaignBoard(services.library);
  autosave = new CampaignAutosave({
    gameManager: gm,
    library: services.library,
    combat: gm.characterServices.combat,
  });
  await autosave.start(sceneState({ ruleset: '2024', name: 'Unlinked creature' }));
});

afterEach(() => {
  autosave?.dispose();
  if (gm) {
    for (const token of [...gm.placedTokens]) gm.tokenManager.removeToken(token);
    gm.token3DAdapter.disposeMovementRange();
  }
  workspace?.close();
});

test('retrieving a saved character places its chosen appearance and links the same record without resetting resources', async () => {
  const before = services.library.get(characterId);
  const layouts = services.library.layouts.snapshot(characterId);
  const placed = await placeSavedCharacter(gm, characterId, 3, 3, { appearance: 'knight' });
  expect(placed.created).toBe(true);
  expect(placed.token).toMatchObject({
    characterSheetId: characterId,
    name: 'Existing hero',
    nameMode: 'character',
    type: 'knight',
    gridX: 3,
    gridY: 3,
  });
  expect(await getTokenCharacter(gm, placed.token, gm.characterServices)).toEqual(before);
  expect(services.library.get(characterId)).toEqual(before);
  expect(services.library.layouts.snapshot(characterId)).toEqual(layouts);
  expect(services.library.list()).toHaveLength(1);
  await autosave.flush();
  const saved = await workspace.store.readCharacters(services.campaign.id);
  const scene = JSON.parse(saved.scene);
  expect(scene.creatures.filter((token) => token.characterId === characterId)).toHaveLength(1);
  expect(scene.creatures.find((token) => token.characterId === characterId).type).toBe('knight');

  const again = await placeSavedCharacter(gm, characterId, 4, 3);
  expect(again).toEqual({ token: placed.token, created: false });
  expect(gm.placedTokens).toHaveLength(2);
  expect(placed.token.gridX).toBe(3);

  gm.tokenManager.removeToken(placed.token);
  await autosave.flush();
  expect(services.library.get(characterId)).toEqual(before);
  const restored = await placeSavedCharacter(gm, characterId, 3, 4, { appearance: 'knight' });
  expect(restored.created).toBe(true);
  expect(restored.token.characterSheetId).toBe(characterId);
  expect(restored.token.type).toBe('knight');
  expect(services.library.get(characterId)).toEqual(before);
  await autosave.flush();
  const reopened = await workspace.open(services.campaign.id);
  const board = createCampaignBoard(reopened.library);
  const restoredSave = new CampaignAutosave({
    gameManager: board,
    library: reopened.library,
    combat: board.characterServices.combat,
  });
  try {
    await restoredSave.start(reopened.scene);
    const same = board.placedTokens.find((token) => token.characterSheetId === characterId);
    expect(same).toMatchObject({ type: 'knight', characterSheetId: characterId });
    expect(reopened.library.get(characterId)).toEqual(before);
    expect(reopened.library.layouts.snapshot(characterId)).toEqual(layouts);
    const copy = await reopened.library.import(reopened.library.export(characterId));
    expect(reopened.library.get(copy)).toMatchObject({
      portraitImage: before.portraitImage,
      artworkImage: before.artworkImage,
    });
  } finally {
    restoredSave.dispose();
    for (const token of [...board.placedTokens]) board.tokenManager.removeToken(token);
    board.token3DAdapter.disposeMovementRange();
  }
});

test('occupied cells and failed saves do not replace actors, consume IDs or create partial placements', async () => {
  const actors = [...gm.placedTokens];
  const nextId = gm.tokenManager._nextTokenId;
  const before = services.library.get(characterId);
  await expect(
    placeSavedCharacter(gm, characterId, 1, 1, { appearance: 'knight' })
  ).rejects.toThrow('occupied');
  expect(gm.placedTokens).toEqual(actors);
  expect(gm.tokenManager._nextTokenId).toBe(nextId);
  const save = jest
    .spyOn(services.library, 'saveScene')
    .mockRejectedValueOnce(new Error('Host disk unavailable'));
  try {
    await expect(
      placeSavedCharacter(gm, characterId, 3, 3, { appearance: 'knight' })
    ).rejects.toThrow('Host disk unavailable');
    expect(gm.placedTokens).toEqual(actors);
    expect(gm.tokenManager._nextTokenId).toBe(nextId);
    expect(services.library.get(characterId)).toEqual(before);
    expect(gm.campaignViewBusy).toBe(false);
  } finally {
    save.mockRestore();
  }
});

test('a visual failure after acknowledgment retains the saved placement and requires recovery instead of claiming rollback', async () => {
  const restore = jest
    .spyOn(gm.token3DAdapter, 'restoreStablePlacement')
    .mockRejectedValueOnce(new Error('Appearance renderer unavailable'));
  try {
    await expect(
      placeSavedCharacter(gm, characterId, 3, 3, { appearance: 'knight' })
    ).rejects.toThrow('saved');
    const saved = await workspace.store.readCharacters(services.campaign.id);
    expect(
      JSON.parse(saved.scene).creatures.some((token) => token.characterId === characterId)
    ).toBe(true);
    expect(gm.campaignMapFailure).toBeTruthy();
    expect(services.library.get(characterId).hp).toEqual({ max: 10, current: 4, temp: 3 });
  } finally {
    restore.mockRestore();
  }
});

test('players and unsettled campaign views cannot retrieve saved characters', async () => {
  const actors = [...gm.placedTokens];
  const nextId = gm.tokenManager._nextTokenId;
  gm.characterServices.sessionRole = 'player';
  await expect(placeSavedCharacter(gm, characterId, 3, 3)).rejects.toThrow('DM command');
  gm.characterServices.sessionRole = 'dm';
  gm.campaignViewBusy = true;
  await expect(placeSavedCharacter(gm, characterId, 3, 3)).rejects.toThrow('Finish');
  gm.campaignViewBusy = false;
  expect(gm.placedTokens).toEqual(actors);
  expect(gm.tokenManager._nextTokenId).toBe(nextId);
});

test.each([
  [-1, 3, {}, 'inside the current area'],
  [3, 3, { appearance: 'missing-model' }, 'available token appearance'],
  [3, 3, { appearance: undefined }, 'available token appearance'],
  [3, 3, { surface: { kind: 'wall', point: { y: 0 } } }, 'walkable floor'],
  [3, 3, { surface: { kind: 'floor', point: { y: NaN } } }, 'walkable floor'],
  [3, 3, { surface: { kind: 'floor', point: { y: 0 }, mapId: 'other-area' } }, 'walkable floor'],
  [3, 3, { surface: { kind: 'floor', point: { y: 100 } } }, 'chosen floor'],
])(
  'invalid placement (%s, %s, %j) leaves the scene and character unchanged',
  async (x, y, options, message) => {
    const actors = [...gm.placedTokens];
    const nextId = gm.tokenManager._nextTokenId;
    const before = services.library.get(characterId);
    await expect(
      placeSavedCharacter(gm, characterId, x, y, { appearance: 'knight', ...options })
    ).rejects.toThrow(message);
    expect(gm.placedTokens).toEqual(actors);
    expect(gm.tokenManager._nextTokenId).toBe(nextId);
    expect(services.library.get(characterId)).toEqual(before);
    expect(gm.campaignViewBusy).toBe(false);
  }
);

test('opening and editing an unplaced sheet reuses its saved record and captures the real board rather than presentation tokens', async () => {
  await autosave.flush();
  const library = services.library;
  const before = library.get(characterId);
  const actors = [...gm.placedTokens];
  const provider = library.sceneProvider;
  const revision = library.revision;
  const nextId = gm.tokenManager._nextTokenId;
  const selected = gm.token3DAdapter.getSelectedToken();
  const sheets = new SavedCharacterSheets({ library, gameManager: gm });
  try {
    await sheets.open(characterId);
    expect(sheets.library).toBe(library);
    expect(sheets.services).toMatchObject({ sessionRole: 'dm', sheetContext: 'library' });
    expect(library.sceneProvider).toBe(provider);
    expect(library.revision).toBe(revision);
    expect(library.list()).toHaveLength(1);
    expect(gm.placedTokens).toEqual(actors);
    expect(gm.tokenManager._nextTokenId).toBe(nextId);
    expect(gm.token3DAdapter.getSelectedToken()).toBe(selected);
    expect(sheets.sheets.root.querySelector('[data-sheet-action="new"]').disabled).toBe(true);
    expect(sheets.sheets.root.querySelector('[aria-label="Saved characters"]').disabled).toBe(true);
    expect(sheets.sheets.root.querySelector('[data-sheet-section="combat"]').disabled).toBe(true);
    expect(sheets.sheets.root.querySelector('[data-sheet-section="noncombat"]').disabled).toBe(
      true
    );
    expect(sheets.sheets.root.querySelector('[data-character-field^="fallTraits."]').disabled).toBe(
      false
    );
    sheets.sheets.root.querySelector('[data-sheet-section="notes"]').click();
    const notes = sheets.sheets.root.querySelector('[data-character-field="notes"]');
    notes.value = 'Edited while safely unplaced';
    notes.dispatchEvent(new Event('change', { bubbles: true }));
    await library.flush();
    expect(library.get(characterId)).toEqual({ ...before, notes: 'Edited while safely unplaced' });
    const saved = await workspace.store.readCharacters(services.campaign.id);
    expect(JSON.parse(saved.scene).creatures.map((token) => token.id)).toEqual(
      actors.map((token) => token.id)
    );
    expect(gm.placedTokens).toEqual(actors);
    expect(gm.token3DAdapter.getSelectedToken()).toBe(selected);
  } finally {
    sheets.destroy();
  }
}, 30000);

function rosterInput() {
  const coordinator = new InputCoordinator(gm);
  gm.inputCoordinator = coordinator;
  gm.pickingService = {
    pickGround: jest.fn(async () => ({
      grid: { gx: 3, gy: 3 },
      world: { x: 3.5, y: 0, z: 3.5 },
    })),
  };
  return coordinator;
}

test('real click/drop input retrieves a saved identity and stale duplicate placement only focuses the same token', async () => {
  const coordinator = rosterInput();
  const before = services.library.get(characterId);
  gm.tokenManager.selectSavedCharacter(characterId, 'female-archer');
  expect(
    await coordinator.handleSavedCharacterDrop(
      JSON.stringify({ characterId, appearance: 'female-archer' }),
      120,
      80
    )
  ).toBe(true);
  const token = gm.placedTokens.find((entry) => entry.characterSheetId === characterId);
  expect(token.type).toBe('female-archer');
  expect(gm.tokenManager.selectedSavedCharacterId).toBeNull();
  expect(services.library.get(characterId)).toEqual(before);
  expect(await coordinator.handleSavedCharacterPlacement(characterId, 'knight', 120, 80)).toBe(
    true
  );
  expect(gm.placedTokens.filter((entry) => entry.characterSheetId === characterId)).toEqual([
    token,
  ]);
  expect(token.type).toBe('female-archer');
  expect(gm.token3DAdapter.getSelectedToken()).toBe(token);
});

test('saved-character misses and malformed drags never fall back to generic replacement or 2D placement', async () => {
  const coordinator = rosterInput();
  const before = [...gm.placedTokens];
  const fallback = jest.fn(() => ({ gridX: 1, gridY: 1 }));
  gm.interactionManager = { getGridCoordinatesFromClick: fallback };
  gm.pickingService.pickGround.mockResolvedValueOnce(null);
  expect(await coordinator.handleSavedCharacterPlacement(characterId, 'knight', 120, 80)).toBe(
    false
  );
  expect(await coordinator.handleSavedCharacterDrop('not JSON', 120, 80)).toBe(false);
  expect(await coordinator.handleSavedCharacterDrop('{"characterId":"wrong"}', 120, 80)).toBe(
    false
  );
  expect(fallback).not.toHaveBeenCalled();
  expect(gm.placedTokens).toEqual(before);
  expect(coordinator.savedCharacterPending).toBe(false);
});

test('an in-flight saved pick blocks concurrent saved, generic and remove inputs without consuming another token identity', async () => {
  const coordinator = rosterInput();
  const actors = [...gm.placedTokens];
  const nextId = gm.tokenManager._nextTokenId;
  let finishPick;
  gm.pickingService.pickGround.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishPick = resolve;
      })
  );
  const pending = coordinator.handleSavedCharacterPlacement(characterId, 'knight', 120, 80);
  expect(coordinator.savedCharacterPending).toBe(true);
  expect(await coordinator.handleSavedCharacterPlacement(characterId, 'knight', 120, 80)).toBe(
    false
  );
  expect(coordinator.savedCharacterPending).toBe(true);
  expect(await coordinator.handleTokenDrop('mutant', 120, 80)).toBe(false);
  coordinator.handleTokenInteraction(1, 1);
  expect(gm.placedTokens).toEqual(actors);
  expect(gm.tokenManager._nextTokenId).toBe(nextId);
  finishPick({ grid: { gx: 3, gy: 3 }, world: { x: 3.5, y: 0, z: 3.5 } });
  expect(await pending).toBe(true);
  expect(gm.tokenManager._nextTokenId).toBe(nextId + 1);
  expect(coordinator.savedCharacterPending).toBe(false);
});

test('saved placement precedes facing and radial/navigation capture even on an occupied creature cell', async () => {
  const coordinator = rosterInput();
  const actors = [...gm.placedTokens];
  const canvas = document.createElement('canvas');
  document.body.append(canvas);
  gm.getEventCanvas = () => canvas;
  gm.threeSceneManager.camera = {};
  gm.pickingService.pickGround.mockResolvedValueOnce({
    grid: { gx: 1, gy: 1 },
    world: { x: 1.5, y: 0, z: 1.5 },
    token: actors[0],
  });
  gm.pickingService.pickGroundSync = jest.fn(() => ({ token: actors[0] }));
  const interactions = new InteractionManager(gm);
  gm.interactionManager = interactions;
  interactions.setupMouseInteractions();
  gm.tokenManager.selectSavedCharacter(characterId, 'knight');
  const status = new Promise((resolve) => {
    window.addEventListener('taverntable:savedCharacterPlacement', resolve, { once: true });
  });
  try {
    canvas.dispatchEvent(new MouseEvent('mousedown', { button: 0, clientX: 120, clientY: 80 }));
    expect((await status).detail).toMatchObject({ success: false });
    expect(gm.pickingService.pickGroundSync).not.toHaveBeenCalled();
    expect(interactions._facingGesture.active).toBeNull();
    expect(gm.placedTokens).toEqual(actors);
    expect(coordinator.savedCharacterPending).toBe(false);
  } finally {
    interactions._facingGesture.detach();
    canvas.remove();
  }
});

test('palette and remove selection cancel saved placement, and players cannot arm the DM roster', () => {
  gm.tokenManager.selectSavedCharacter(characterId, 'knight');
  expect(gm.tokenManager.selectedSavedCharacterId).toBe(characterId);
  gm.tokenManager.selectToken('mutant');
  expect(gm.tokenManager.selectedSavedCharacterId).toBeNull();
  gm.tokenManager.selectSavedCharacter(characterId, 'knight');
  gm.tokenManager.selectToken('remove');
  expect(gm.tokenManager.selectedSavedCharacterId).toBeNull();
  gm.characterServices.sessionRole = 'player';
  expect(() => gm.tokenManager.selectSavedCharacter(characterId, 'knight')).toThrow('DM');
});

test('unsupported saved-model preferences remain rejected by existing edit/import validators without changing stored records', async () => {
  const before = await workspace.store.readCharacters(services.campaign.id);
  await expect(services.library.edit(characterId, { tokenAppearance: 'knight' })).rejects.toThrow(
    'Unknown or read-only character field'
  );
  const backup = JSON.parse(services.library.export(characterId));
  backup.character.tokenAppearance = 'knight';
  await expect(services.library.import(JSON.stringify(backup))).rejects.toThrow(
    'unsupported fields'
  );
  const after = await workspace.store.readCharacters(services.campaign.id);
  expect(after.records).toEqual(before.records);
  expect(after.revision).toBe(before.revision);
});
