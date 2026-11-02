import CampaignMapControls from '../../../src/ui/campaigns/CampaignMapControls.js';
import CampaignWorld from '../../../src/campaigns/CampaignWorld.js';
import { restoreCampaignScene } from '../../../src/campaigns/SceneWorld.js';
import { CharacterLibrary } from '../../../src/entities/characters/CharacterLibrary.js';
import { createCampaignBoard } from '../../helpers/campaignBoard.js';
import { sceneState } from '../../helpers/sceneState.js';
import { GameErrors } from '../../../src/utils/error/ErrorHandler.js';

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
let gm, controls;

beforeEach(async () => {
  localStorage.clear();
  const library = new CharacterLibrary({ ruleset: '2014', catalog: [], storage: localStorage });
  const scene = sceneState();
  scene.terrain.heights = scene.terrain.heights.map((row) => row.map(() => 0));
  const world = CampaignWorld.fromScene(scene, { ruleset: '2014', library });
  world.addMap({
    id: 'inside',
    name: 'Interior',
    originFeet: { x: 10, y: 0, z: 0 },
    quarterTurns: 0,
    base: 'floor',
    grid: { ...scene.grid },
    terrain: { ...scene.terrain },
  });
  const saved = world.save();
  saved.view.focusTokenId = 'token-1';
  saved.creatures.push({
    ...saved.creatures[0],
    id: 'token-2',
    instanceNumber: 2,
    name: 'Inside Scout',
    mapId: 'inside',
    gridX: 3,
    gridY: 2,
    pose: { kind: 'ground', world: { x: 3.5, y: 0, z: 2.5 } },
  });
  saved.tokenCounters.nextId = 2;
  saved.tokenCounters.types[0][1] = 2;
  gm = createCampaignBoard(library);
  await restoreCampaignScene(gm, saved, library, gm.characterServices.combat);
  controls = new CampaignMapControls({ gameManager: gm });
  document.body.append(controls.root);
});

afterEach(() => {
  controls?.dispose();
  for (const token of [...gm.placedTokens]) gm.tokenManager.removeToken(token);
  gm.token3DAdapter.disposeMovementRange();
  document.body.replaceChildren();
});

test('the map selector browses the actual interior without moving or copying any creature', async () => {
  const actors = [...gm.placedTokens];
  const selector = controls.root.querySelector('[aria-label="Viewed map"]');
  expect([...selector.options].map((option) => option.textContent)).toEqual([
    'Main map',
    'Interior',
  ]);
  selector.value = 'inside';
  selector.dispatchEvent(new Event('change', { bubbles: true }));
  await settle();
  expect(gm.campaignMapId).toBe('inside');
  expect(gm.campaignView.focusTokenId).toBeNull();
  expect(gm.placedTokens[0]).toBe(actors[0]);
  expect(gm.placedTokens[1]).toBe(actors[1]);
  expect(controls.root.querySelector('[aria-label="Map view status"]').textContent).toContain(
    'Interior'
  );
});

test('focusing a creature opens its map while later target selection does not change viewing focus', async () => {
  const selector = controls.root.querySelector('[aria-label="Focused creature"]');
  selector.value = 'token-2';
  selector.dispatchEvent(new Event('change', { bubbles: true }));
  await settle();
  expect(gm.campaignMapId).toBe('inside');
  expect(gm.campaignView.focusTokenId).toBe('token-2');
  expect(gm.token3DAdapter.getSelectedToken()).toBe(gm.placedTokens[1]);
  await gm.token3DAdapter.setSelectedToken(gm.placedTokens[0]);
  expect(gm.campaignMapId).toBe('inside');
  expect(gm.campaignView.focusTokenId).toBe('token-2');
  expect(selector.value).toBe('token-2');
});

test('a failed map change reports its error and restores the map selector', async () => {
  const notification = jest.spyOn(GameErrors, 'input').mockImplementation(() => {});
  gm.ensureInstancing = () => ({
    restorePlacements: async () => {
      if (gm.campaignMapId === 'inside') throw new Error('Interior assets unavailable');
    },
  });
  try {
    const selector = controls.root.querySelector('[aria-label="Viewed map"]');
    selector.value = 'inside';
    selector.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    expect(selector.value).toBe('map-main');
    expect(gm.campaignMapId).toBe('map-main');
    expect(controls.root.querySelector('[aria-label="Map view status"]').textContent).toContain(
      'Interior assets unavailable'
    );
    expect(notification).toHaveBeenCalled();
    expect(selector.disabled).toBe(false);
  } finally {
    notification.mockRestore();
  }
});

test('legacy single-board campaigns do not expose nonfunctional connected-map controls', () => {
  gm.campaignWorld = null;
  controls.render();
  expect(controls.root.hidden).toBe(true);
});
