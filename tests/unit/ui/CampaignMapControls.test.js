import CampaignMapControls from '../../../src/ui/campaigns/CampaignMapControls.js';
import CampaignWorld from '../../../src/campaigns/CampaignWorld.js';
import { restoreCampaignScene } from '../../../src/campaigns/SceneWorld.js';
import { CharacterLibrary } from '../../../src/entities/characters/CharacterLibrary.js';
import { createCampaignBoard } from '../../helpers/campaignBoard.js';
import { sceneState } from '../../helpers/sceneState.js';
import { GameErrors } from '../../../src/utils/error/ErrorHandler.js';
import { TerrainEngine } from '../../../src/terrain/TerrainEngine.js';
import { reconcileCavernScene } from '../../../src/campaigns/CavernAssembly.js';
import { reconcileBuildingScene } from '../../../src/campaigns/BuildingAssembly.js';

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

test('the DM overview browses locations without moving creatures or changing their maps', async () => {
  const original = gm.campaignWorld.save().maps.find((map) => map.id === 'map-main');
  gm.campaignWorld.addLocation({
    id: 'location-other',
    name: 'Other location',
    map: {
      ...original,
      id: 'other-map',
      name: 'Other map',
      locationId: 'location-other',
    },
  });
  const creatures = gm.placedTokens.map((token) => ({
    token,
    mapId: token.mapId,
    gridX: token.gridX,
    gridY: token.gridY,
  }));
  await controls.openOverview();
  const dialog = controls.overview.root;
  expect(dialog.hidden).toBe(false);
  expect(
    [...dialog.querySelectorAll('[data-overview-map]')]
      .map((node) => node.getAttribute('data-overview-map'))
      .sort()
  ).toEqual(['inside', 'map-main']);
  expect(
    [...dialog.querySelectorAll('[data-overview-creature]')]
      .map((node) => node.getAttribute('data-overview-creature'))
      .sort()
  ).toEqual(['token-1', 'token-2']);
  gm.placedTokens[0].name = 'Updated Rook';
  await controls.overview.refresh();
  expect(dialog.querySelector('[data-overview-creature="token-1"] title').textContent).toBe(
    'Updated Rook'
  );
  const select = dialog.querySelector('[aria-label="Overview location"]');
  select.value = 'location-other';
  select.dispatchEvent(new Event('change', { bubbles: true }));
  expect(dialog.querySelector('[data-overview-map]').getAttribute('data-overview-map')).toBe(
    'other-map'
  );
  expect(gm.campaignMapId).toBe('map-main');
  for (const before of creatures)
    expect(before.token).toMatchObject({
      mapId: before.mapId,
      gridX: before.gridX,
      gridY: before.gridY,
    });
  dialog.querySelector('[data-overview-areas] button').click();
  await settle();
  expect(gm.campaignMapId).toBe('other-map');
  expect(dialog.hidden).toBe(true);
  for (const before of creatures)
    expect(before.token).toMatchObject({
      mapId: before.mapId,
      gridX: before.gridX,
      gridY: before.gridY,
    });
});

test('the overview distinguishes connected building floors with labeled stairs', async () => {
  const engine = new TerrainEngine(25, 25);
  engine.placeStructure({
    id: 'house',
    kind: 'building',
    xFeet: 60,
    zFeet: 60,
    heightFeet: 30,
    lengthFeet: 30,
    widthFeet: 25,
    building: { roof: 'gable' },
  });
  const scene = sceneState();
  scene.version = 2;
  scene.grid = { cols: 25, rows: 25, tileWorldSize: 1 };
  scene.creatures = [];
  scene.terrain.heights = engine.save().heights;
  scene.terrain.geometry = engine.geometry.save();
  const library = gm.characterServices.library;
  const assembled = reconcileBuildingScene(scene, { ruleset: library.ruleset, library });
  await restoreCampaignScene(gm, assembled, library, gm.characterServices.combat);
  await controls.openOverview();
  const dialog = controls.overview.root;
  expect(dialog.querySelectorAll('[data-overview-map]')).toHaveLength(4);
  expect(dialog.querySelectorAll('[data-kind="stairs"]')).toHaveLength(4);
  expect(dialog.textContent).toContain('Level +10 ft');
  expect(dialog.textContent).toContain('Level +20 ft');
  expect(dialog.textContent).toMatch(/stairs to/i);
});

test('the overview labels a real ladder between a building and its cellar', async () => {
  const engine = new TerrainEngine(30, 30);
  engine.placeStructure({
    id: 'hall',
    kind: 'building',
    xFeet: 60,
    zFeet: 60,
    heightFeet: 30,
    lengthFeet: 40,
    widthFeet: 30,
    building: { stairs: false },
  });
  engine.placeStructure({
    id: 'cellar',
    kind: 'cellar',
    xFeet: 70,
    zFeet: 70,
    heightFeet: 20,
    lengthFeet: 60,
    widthFeet: 60,
    building: {
      access: { kind: 'ladder', structureId: 'hall', xFeet: 0, zFeet: 0 },
    },
  });
  const scene = sceneState();
  scene.version = 2;
  scene.grid = { cols: 30, rows: 30, tileWorldSize: 1 };
  scene.creatures = [];
  scene.terrain.heights = engine.save().heights;
  scene.terrain.geometry = engine.geometry.save();
  const library = gm.characterServices.library;
  const assembled = reconcileBuildingScene(scene, { ruleset: library.ruleset, library });
  await restoreCampaignScene(gm, assembled, library, gm.characterServices.combat);
  await controls.openOverview();
  const dialog = controls.overview.root;
  expect(dialog.querySelectorAll('[data-kind="ladder"]')).toHaveLength(2);
  expect(dialog.textContent).toContain('Ladder');
  expect(dialog.textContent).toContain('Level -10 ft');
});

test('the overview renders dungeon walls and actual door openings', async () => {
  const engine = new TerrainEngine(25, 25);
  engine.generateBiomeElevation('dungeon', { seed: 42, dungeonRoomCount: 6 });
  const scene = sceneState();
  scene.version = 2;
  scene.grid = { cols: 25, rows: 25, tileWorldSize: 1 };
  scene.creatures = [];
  scene.terrain.heights = engine.save().heights;
  scene.terrain.geometry = engine.geometry.save();
  scene.terrain.biome = 'dungeon';
  const library = gm.characterServices.library;
  const world = CampaignWorld.fromScene(scene, { ruleset: library.ruleset, library });
  await restoreCampaignScene(gm, world.save(), library, gm.characterServices.combat);
  await controls.openOverview();
  expect(controls.error).toBeNull();
  const map = controls.overview.root.querySelector('[data-overview-map]');
  expect(map.querySelector('.overview-map-wall')?.getAttribute('d').length).toBeGreaterThan(0);
  expect(map.querySelectorAll('[data-overview-door]').length).toBeGreaterThan(0);
});

test('focusing and selecting creatures consistently open their canonical maps', async () => {
  const selector = controls.root.querySelector('[aria-label="Focused creature"]');
  selector.value = 'token-2';
  selector.dispatchEvent(new Event('change', { bubbles: true }));
  await settle();
  expect(gm.campaignMapId).toBe('inside');
  expect(gm.campaignView.focusTokenId).toBe('token-2');
  expect(gm.token3DAdapter.getSelectedToken()).toBe(gm.placedTokens[1]);
  await gm.token3DAdapter.setSelectedToken(gm.placedTokens[0]);
  expect(gm.campaignMapId).toBe('map-main');
  expect(gm.campaignView.focusTokenId).toBe('token-1');
  expect(selector.value).toBe('token-1');
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

test('cavern area controls appear only in an interior and disable already connected sides', async () => {
  expect(controls.newCavern.hidden).toBe(true);
  const engine = new TerrainEngine(25, 25);
  engine.generateBiomeElevation('cavern', { seed: 42 });
  const scene = sceneState();
  scene.version = 2;
  scene.creatures = [];
  scene.grid = { cols: 25, rows: 25, tileWorldSize: 1 };
  Object.assign(scene.terrain, {
    heights: engine.save().heights,
    geometry: engine.geometry.save(),
    cavern: engine.cavern,
    biome: 'cavern',
  });
  const library = gm.characterServices.library;
  await restoreCampaignScene(
    gm,
    reconcileCavernScene(scene, { ruleset: library.ruleset, library }, { regenerate: true }),
    library,
    gm.characterServices.combat
  );
  controls.render();
  expect(controls.newCavern.hidden).toBe(false);
  const sides = controls.newCavern.querySelector('[aria-label="Cavern passage side"]');
  const connectedSides = new Set(
    gm.campaignWorld.getConnections(gm.campaignMapId).map((connection) => connection.cavern.side)
  );
  expect(
    [...sides.options].filter((option) => option.disabled).map((option) => option.value)
  ).toEqual(
    [...sides.options].map((option) => option.value).filter((side) => connectedSides.has(side))
  );
  expect(sides.selectedOptions[0].disabled).toBe(false);
});

test('a remaining main entrance can add a blank linked chamber without regenerating the map', async () => {
  const engine = new TerrainEngine(25, 25);
  engine.generateBiomeElevation('cavern', { seed: 42 });
  const scene = sceneState();
  scene.version = 2;
  scene.creatures = [];
  scene.grid = { cols: 25, rows: 25, tileWorldSize: 1 };
  Object.assign(scene.terrain, {
    heights: engine.save().heights,
    geometry: engine.geometry.save(),
    cavern: engine.cavern,
    biome: 'cavern',
  });
  const library = gm.characterServices.library;
  const saved = reconcileCavernScene(
    scene,
    { ruleset: library.ruleset, library },
    { regenerate: true }
  );
  saved.maps = [saved.maps[0]];
  saved.connections = [];
  await restoreCampaignScene(gm, saved, library, gm.characterServices.combat);
  library.saveScene = jest.fn(async (capture) => ({ captured: await capture(library) }));
  library.flush = jest.fn(async () => {});
  controls.render();
  expect(controls.newLogical.hidden).toBe(false);
  const before = gm.terrainEngine.save();
  const side = controls.newLogical.querySelector('[aria-label="Linked cavern entrance"]');
  const selected = side.value;
  controls.newLogical.querySelector('[aria-label="Linked area name"]').value = 'New chamber';
  await controls.createLogicalArea();
  expect(gm.terrainEngine.save()).toEqual(before);
  expect(gm.campaignWorld.listMaps()).toHaveLength(2);
  expect(gm.campaignWorld.getLogicalPassages('map-main')[0].ends[0].side).toBe(selected);
  expect([...side.options].find((option) => option.value === selected).disabled).toBe(true);
});

test('the outside destination control can link two entrances to the same blank map', async () => {
  const engine = new TerrainEngine(25, 25);
  engine.generateBiomeElevation('cavern', { seed: 42, cavernExitCount: 3 });
  const scene = sceneState();
  scene.version = 2;
  scene.creatures = [];
  scene.grid = { cols: 25, rows: 25, tileWorldSize: 1 };
  Object.assign(scene.terrain, {
    heights: engine.save().heights,
    geometry: engine.geometry.save(),
    cavern: engine.cavern,
    biome: 'cavern',
  });
  const library = gm.characterServices.library;
  const saved = reconcileCavernScene(
    scene,
    { ruleset: library.ruleset, library },
    { regenerate: true }
  );
  saved.maps = [saved.maps[0]];
  saved.connections = [];
  await restoreCampaignScene(gm, saved, library, gm.characterServices.combat);
  let persisted;
  library.saveScene = jest.fn(async (capture) => {
    persisted = await capture(library);
    return { captured: persisted };
  });
  library.flush = jest.fn(async () => {});
  controls.render();
  const type = controls.newLogical.querySelector('[aria-label="Linked area type"]');
  type.value = 'outside';
  type.dispatchEvent(new Event('change', { bubbles: true }));
  const destination = controls.newLogical.querySelector(
    '[aria-label="Linked outside destination"]'
  );
  expect(destination.parentElement.hidden).toBe(false);
  await controls.createLogicalArea();
  const outsideId = gm.campaignWorld.getLogicalPassages('map-main')[0].ends[1].mapId;
  expect([...destination.options].some((option) => option.value === outsideId)).toBe(true);
  destination.value = outsideId;
  await controls.createLogicalArea();
  const passages = gm.campaignWorld.getLogicalPassages('map-main');
  expect(gm.campaignWorld.listMaps()).toHaveLength(2);
  expect(passages).toHaveLength(2);
  expect(passages.every((passage) => passage.ends[1].mapId === outsideId)).toBe(true);
  expect(new Set(passages.map((passage) => passage.ends[1].side)).size).toBe(2);
  expect(persisted.scene.logicalPassages).toEqual(passages);
});

test('creating and browsing an independent location does not move, recreate or reset existing actors', async () => {
  const actors = [...gm.placedTokens];
  const before = gm.campaignWorld.save().creatures;
  let persisted;
  gm.characterServices.library.saveScene = jest.fn(async (capture) => {
    persisted = capture();
    return { captured: persisted, receipt: { revision: 1 } };
  });
  controls.render();
  controls.newLocation.querySelector('input').value = 'Separate dungeon';
  await controls.createLocation();
  expect(persisted.scene.locations).toHaveLength(2);
  expect(persisted.scene.creatures).toMatchObject(before);
  expect(gm.campaignMapId).toBe('map-main');
  expect(gm.placedTokens).toEqual(actors);
  const remote = gm.campaignWorld
    .listLocations()
    .find((location) => location.name === 'Separate dungeon');
  const selector = controls.root.querySelector('[aria-label="Viewed location"]');
  selector.value = remote.id;
  selector.dispatchEvent(new Event('change', { bubbles: true }));
  await settle();
  expect(gm.campaignWorld.getLocationId(gm.campaignMapId)).toBe(remote.id);
  expect(gm.campaignView.focusTokenId).toBeNull();
  expect(gm.placedTokens[0]).toBe(actors[0]);
  expect(gm.placedTokens[1]).toBe(actors[1]);
  expect(gm.placedTokens.map((token) => token.mapId)).toEqual(before.map((token) => token.mapId));
  expect([...controls.map.options].map((option) => option.textContent)).toEqual(['Main area']);
});

test('a failed location save leaves the current world and actors unchanged and reports the error', async () => {
  const notification = jest.spyOn(GameErrors, 'input').mockImplementation(() => {});
  const before = gm.campaignWorld.save();
  gm.characterServices.library.saveScene = jest.fn(async () => {
    throw new Error('Host disk unavailable');
  });
  controls.newLocation.querySelector('input').value = 'Must not appear';
  try {
    await controls.createLocation();
    expect(gm.campaignWorld.save()).toEqual(before);
    expect(gm.campaignViewBusy).toBe(false);
    expect(controls.status.textContent).toContain('Host disk unavailable');
    expect(notification).toHaveBeenCalled();
  } finally {
    notification.mockRestore();
  }
});
