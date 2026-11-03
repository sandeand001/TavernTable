import CampaignWorld from '../../../src/campaigns/CampaignWorld.js';
import { changeCampaignView, restoreCampaignScene } from '../../../src/campaigns/SceneWorld.js';
import { CharacterLibrary } from '../../../src/entities/characters/CharacterLibrary.js';
import { CompendiumCatalog } from '../../../src/entities/characters/CompendiumCatalog.js';
import CharacterSheetWindow from '../../../src/ui/components/CharacterSheetWindow.js';
import CampaignMapControls from '../../../src/ui/campaigns/CampaignMapControls.js';
import { ErrorHandler } from '../../../src/utils/error/ErrorHandler.js';
import { connectCharacterServices } from '../../../src/ui/characters/characterServices.js';
import { createCampaignBoard } from '../../helpers/campaignBoard.js';
import { sceneState } from '../../helpers/sceneState.js';
import classic from '../../../assets/data/resources/srd-2014-5.1-seed.1.json';

let gm;
let sheets;

beforeEach(async () => {
  localStorage.clear();
  const catalog = new CompendiumCatalog({
    version: 1,
    ruleset: '2014',
    entries: classic.entries,
    classes: classic.classes,
  });
  const library = new CharacterLibrary({
    ruleset: '2014',
    storage: localStorage,
    catalog: catalog.entries,
    classes: catalog.classes,
  });
  const legacy = sceneState({
    characterId: library.create('Exterior Scout'),
    name: 'Exterior Scout',
  });
  legacy.terrain.heights = legacy.terrain.heights.map((row) => row.map(() => 0));
  const world = CampaignWorld.fromScene(legacy, { ruleset: '2014', library });
  world.addMap({
    id: 'inside',
    name: 'Interior',
    originFeet: { x: 10, y: 0, z: 0 },
    quarterTurns: 0,
    base: 'floor',
    grid: legacy.grid,
    terrain: legacy.terrain,
  });
  const saved = world.save();
  saved.creatures.push({
    ...saved.creatures[0],
    id: 'token-2',
    instanceNumber: 2,
    name: 'Interior Guard',
    characterId: library.create('Interior Guard'),
    mapId: 'inside',
  });
  saved.creatures.push({
    ...saved.creatures[1],
    id: 'token-3',
    instanceNumber: 3,
    name: 'Interior Ally',
    characterId: library.create('Interior Ally'),
    gridX: 3,
    pose: { kind: 'ground', world: { x: 3.5, y: 0, z: 1.5 } },
  });
  saved.tokenCounters.nextId = 3;
  saved.tokenCounters.types[0][1] = 3;
  gm = createCampaignBoard(library);
  gm.characterServices = null;
  connectCharacterServices(gm, { library, catalog });
  gm.threeSceneManager.setCameraTarget = (x, z, y) => {
    gm.threeSceneManager.restoreView({
      ...gm.threeSceneManager.snapshotView(),
      target: { x, y, z },
    });
  };
  await restoreCampaignScene(gm, saved, library, gm.characterServices.combat);
  sheets = new CharacterSheetWindow({
    gameManager: gm,
    characterServices: gm.characterServices,
  }).attach();
});

afterEach(() => {
  sheets?.destroy();
  gm?.characterServices?.targeting?.dispose();
  gm?.characterServices?.falling?.dispose();
  for (const token of gm?.placedTokens.slice() ?? []) gm.tokenManager.removeToken(token);
  gm?.token3DAdapter.disposeMovementRange();
  jest.restoreAllMocks();
});

test.each(['click', 'keyboard', 'pop-out'])(
  '%s tab activation selects the active sprite and restores End Turn after same/cross-map browsing',
  async (mode) => {
    const [scout, guard, ally] = gm.placedTokens;
    await sheets.open(scout);
    sheets.root.querySelector('[data-sheet-section="combat"]').click();
    await sheets.open(ally);
    await sheets.open(guard);
    sheets.root.querySelector('[data-sheet-section="combat"]').click();
    sheets.root.querySelector('[data-sheet-action="turn-start"]').click();
    expect(gm.characterServices.combat.activeToken).toBe(guard);
    gm.characterServices.combat.adjustMovement(guard, 15);
    const budget = gm.characterServices.combat.snapshot();
    const positions = gm.placedTokens.map((token) => ({ ...token.world }));
    let frame = null;
    if (mode === 'pop-out') {
      frame = document.createElement('iframe');
      document.body.append(frame);
      const popout = frame.contentWindow;
      Object.defineProperty(popout, 'closed', { value: false, writable: true });
      jest.spyOn(popout, 'focus').mockImplementation(() => {});
      jest.spyOn(popout, 'close').mockImplementation(() => {
        popout.closed = true;
      });
      jest.spyOn(window, 'open').mockReturnValue(popout);
      expect(sheets.popOut()).toBe(true);
    }
    const controls = [];
    const observe = (event) => {
      if (event.detail?.gameManager === gm)
        controls.push({
          busy: gm.campaignViewBusy,
          disabled: sheets.root.querySelector('[data-sheet-action="turn-end"]').disabled,
        });
    };
    window.addEventListener('taverntable:campaignViewStateChanged', observe);
    try {
      await sheets.open(scout);
      await sheets.open(ally);
      if (mode === 'keyboard')
        sheets.tabs
          .get(ally)
          .button.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })
          );
      else sheets.tabs.get(guard).button.click();
      await sheets.ready;
      expect(gm.token3DAdapter.getSelectedToken()).toBe(guard);
      expect(gm.characterServices.combat.activeToken).toBe(guard);
      expect(gm.campaignViewBusy).toBe(false);
      expect(gm.characterServices.combat.snapshot()).toEqual(budget);
      expect(gm.placedTokens.map((token) => token.world)).toEqual(positions);
      expect(controls.some((state) => state.busy)).toBe(true);
      expect(controls.every((state) => state.disabled === state.busy)).toBe(true);
      const end = sheets.root.querySelector('[data-sheet-action="turn-end"]');
      expect(end.disabled).toBe(false);
      end.click();
      expect(gm.characterServices.combat.activeToken).toBeNull();
    } finally {
      window.removeEventListener('taverntable:campaignViewStateChanged', observe);
      if (frame) {
        sheets.dock({ focus: false });
        frame.remove();
      }
    }
  }
);

test('opening a projected creature sheet focuses its canonical map without moving or refreshing it', async () => {
  const [scout, guard] = gm.placedTokens;
  const tokens = [...gm.placedTokens];
  gm.characterServices.combat.startTurn(scout);
  gm.characterServices.combat.adjustMovement(scout, 15);
  const budget = gm.characterServices.combat.snapshot();
  const positions = gm.placedTokens.map((token) => ({ ...token.world }));
  await changeCampaignView(gm, { focusTokenId: guard.id });
  await sheets.open(scout);
  expect(gm.campaignMapId).toBe('map-main');
  expect(gm.campaignView.focusTokenId).toBe(scout.id);
  expect(gm.threeSceneManager.snapshotView().target).toEqual(scout.world);
  expect(gm.placedTokens).toHaveLength(tokens.length);
  expect(gm.placedTokens.every((token, i) => token === tokens[i])).toBe(true);
  expect(gm.placedTokens.map((token) => token.world)).toEqual(positions);
  expect(gm.characterServices.combat.snapshot()).toEqual(budget);
});

test.each(['click', 'keyboard', 'neighbor-close'])(
  '%s sheet activation focuses the canonical map rather than a cached projection',
  async (action) => {
    const [scout, guard] = gm.placedTokens;
    await sheets.open(scout);
    await sheets.open(guard);
    expect(gm.campaignMapId).toBe('inside');
    if (action === 'click') sheets.tabs.get(scout).button.click();
    else if (action === 'keyboard')
      sheets.tabs
        .get(guard)
        .button.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true })
        );
    else sheets.tabs.get(guard).close.click();
    await sheets.ready;
    expect(gm.campaignMapId).toBe('map-main');
    expect(gm.campaignView.focusTokenId).toBe(scout.id);
    expect(gm.token3DAdapter.getSelectedToken()).toBe(scout);
    expect(gm.threeSceneManager.snapshotView().target).toEqual(scout.world);
    expect(sheets.root.inert).toBe(false);
  }
);

test('passive projected-token selection updates the sheet without switching its viewed map or camera', async () => {
  const [scout, guard] = gm.placedTokens;
  await sheets.open(guard);
  const camera = gm.threeSceneManager.snapshotView();
  await gm.token3DAdapter.setSelectedToken(scout);
  await sheets.ready;
  expect(sheets.activeToken).toBe(scout);
  expect(gm.campaignMapId).toBe('inside');
  expect(gm.campaignView.focusTokenId).toBe(guard.id);
  expect(gm.threeSceneManager.snapshotView()).toEqual(camera);
});

test('sheet-driven view changes refresh and unlock the Maps & focus controls', async () => {
  const controls = new CampaignMapControls({ gameManager: gm });
  document.body.append(controls.root);
  try {
    await sheets.open(gm.placedTokens[1]);
    expect(controls.map.value).toBe('inside');
    expect(controls.focus.value).toBe(gm.placedTokens[1].id);
    expect(controls.map.disabled).toBe(false);
    expect(controls.center.disabled).toBe(false);
    expect(controls.loading.isConnected).toBe(false);
  } finally {
    controls.dispose();
  }
});

test('a failed sheet focus reports the error and restores the original map without claiming success', async () => {
  const resize = gm.resizeGrid;
  gm.resizeGrid = (...args) => {
    if (gm.campaignMapId === 'inside') throw new Error('Interior rendering failed');
    return resize(...args);
  };
  const error = jest.spyOn(ErrorHandler.prototype, 'handle').mockImplementation(() => {});
  try {
    expect(await sheets.open(gm.placedTokens[1])).toBe(false);
    expect(gm.campaignMapId).toBe('map-main');
    expect(sheets.characterContent.status.textContent).toContain('Interior rendering failed');
    expect(sheets.characterContent.status.classList.contains('sheet-error')).toBe(true);
    expect(sheets.root.inert).toBe(false);
    expect(error).toHaveBeenCalled();
  } finally {
    error.mockRestore();
  }
});
