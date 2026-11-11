import * as three from 'three';
import CreatureLocations from '../../../../src/campaigns/CreatureLocations.js';
import TacticalOverview, {
  layoutOverviewTokens,
  tacticalFootprintContains,
} from '../../../../src/scene/token-adapter/TacticalOverview.js';
import { changeCampaignView } from '../../../../src/campaigns/SceneWorld.js';
import { GameErrors } from '../../../../src/utils/error/ErrorHandler.js';
import {
  localWorldToCampaign,
  campaignToLocalWorld,
} from '../../../../src/campaigns/CampaignCoordinates.js';

jest.mock('../../../../src/campaigns/SceneWorld.js', () => ({
  changeCampaignView: jest.fn(),
}));

afterEach(() => {
  jest.restoreAllMocks();
  changeCampaignView.mockReset();
});

function overviewFixture() {
  const map = { id: 'cellar', name: 'Cellar', grid: { cols: 5, rows: 5, tileWorldSize: 1 } };
  const actor = { id: 'scout', name: 'Cellar scout', mapId: map.id, world: { x: 1, y: 0, z: 1 } };
  const geometry = { getStructures: () => [] };
  const gm = {
    placedTokens: [actor],
    campaignMapId: map.id,
    terrainEngine: { geometry, onChanged: () => () => {} },
    campaignWorld: {
      mapRevision: 0,
      sharesLocation: () => true,
      listMaps: () => [map],
      getMap: () => map,
      getMapGeometry: () => geometry,
    },
  };
  const overview = new TacticalOverview(gm, three);
  const scene = new three.Scene();
  const camera = new three.OrthographicCamera(-4, 4, 3, -3, 0.1, 100);
  camera.position.set(1, 10, 1);
  camera.lookAt(1, 0, 1);
  camera.updateMatrixWorld(true);
  const canvas = {
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
  };
  const mesh = new three.Mesh(new three.CircleGeometry(0.46), new three.MeshBasicMaterial());
  mesh.position.copy(actor.world);
  const update = () => {
    mesh.position.copy(actor.world);
    overview.update([{ token: actor, mesh }], camera, canvas, scene);
  };
  const dispose = () => {
    overview.dispose();
    mesh.geometry.dispose();
    mesh.material.dispose();
  };
  update();
  return { overview, gm, actor, mesh, update, dispose };
}

test('offscreen overview markers do not leave a large unlabelled token at the viewport edge', () => {
  const { overview, actor, mesh, update, dispose } = overviewFixture();
  try {
    actor.world.x = 100;
    update();
    expect(mesh.visible).toBe(false);
    expect(overview.entries.size).toBe(0);
    actor.world.x = 1;
    update();
    expect(mesh.visible).toBe(true);
    expect(overview.entries.size).toBe(1);
  } finally {
    dispose();
  }
});

test('each overhead label has a keyboard-accessible Focus action using the canonical view helper', async () => {
  const { overview, gm, actor, update, dispose } = overviewFixture();
  let release;
  changeCampaignView.mockImplementation(
    () =>
      new Promise((resolve) => {
        release = resolve;
      })
  );
  try {
    const focus = overview.root.querySelector('button[aria-label="Focus Cellar scout"]');
    expect(focus).not.toBeNull();
    expect(focus.textContent).toBe('Focus');
    focus.click();
    update();
    expect(changeCampaignView).toHaveBeenCalledWith(gm, { focusTokenId: actor.id });
    expect(focus.disabled).toBe(true);
    focus.click();
    expect(changeCampaignView).toHaveBeenCalledTimes(1);
    release();
    await Promise.resolve();
    await Promise.resolve();
    expect(focus.disabled).toBe(false);
    expect(actor.world).toEqual({ x: 1, y: 0, z: 1 });
  } finally {
    dispose();
  }
});

test('a failed Focus action reports its error and allows retry without deleting the marker', async () => {
  const { overview, dispose } = overviewFixture();
  const error = new Error('Finish the current movement before changing maps');
  changeCampaignView.mockRejectedValueOnce(error);
  const reported = jest.spyOn(GameErrors, 'input').mockImplementation(() => {});
  try {
    const focus = overview.root.querySelector('button');
    expect(focus).not.toBeNull();
    focus.click();
    await Promise.resolve();
    await Promise.resolve();
    expect(overview.root.querySelector('[role="status"]').textContent).toContain(error.message);
    expect(reported).toHaveBeenCalledWith(
      error,
      expect.objectContaining({ operation: 'focusCreature' })
    );
    expect(focus.disabled).toBe(false);
  } finally {
    dispose();
  }
});

test('building overview footprints exclude padded map cells and a round tower excludes its square corners', () => {
  const map = {
    id: 'cellar',
    grid: { cols: 10, rows: 10, tileWorldSize: 2 },
    building: { offsetX: 5, offsetZ: 5, lengthFeet: 20, widthFeet: 20 },
  };
  expect(tacticalFootprintContains(map, { x: 4, z: 4 })).toBe(true);
  expect(tacticalFootprintContains(map, { x: 0.5, z: 4 })).toBe(false);
  expect(tacticalFootprintContains(map, { x: 15, z: 4 })).toBe(false);
  expect(tacticalFootprintContains(map, { x: 5.8, z: 2.2 }, { kind: 'turret' })).toBe(true);
  expect(tacticalFootprintContains(map, { x: 2.2, z: 2.2 }, { kind: 'turret' })).toBe(false);
});

test('above/below scope follows translated, rotated and differently scaled physical maps, not source grid cells', () => {
  const maps = [
    {
      id: 'cellar',
      originFeet: { x: 100, y: -10, z: 200 },
      quarterTurns: 1,
      grid: { cols: 5, rows: 5, tileWorldSize: 2 },
    },
    {
      id: 'outside',
      originFeet: { x: 0, y: 0, z: 0 },
      quarterTurns: 0,
      grid: { cols: 50, rows: 50, tileWorldSize: 1 },
    },
  ];
  const map = (id) => maps.find((entry) => entry.id === id);
  const gm = {
    campaignMapId: 'cellar',
    terrainEngine: { onChanged: () => () => {} },
    campaignWorld: {
      mapRevision: 0,
      getMap: map,
      sharesLocation: () => true,
      listMaps: () => maps,
      toCampaignPosition: (id, point) => localWorldToCampaign(map(id), point),
      toMapPosition: (id, point) => campaignToLocalWorld(map(id), point),
    },
  };
  const overview = new TacticalOverview(gm, three);
  const above = { mapId: 'outside', world: { x: 18, y: 6, z: 41.5 } };
  try {
    expect(overview.contains(above)).toBe(true);
    above.world.y = -10;
    expect(overview.contains(above)).toBe(true);
    above.world.x = 2.5;
    above.world.z = 2.5;
    expect(overview.contains(above)).toBe(false);
    expect(overview.contains({ mapId: 'cellar' })).toBe(true);
  } finally {
    overview.dispose();
  }
});

test('stacked floors get separate readable marker slots with canonical anchors retained', () => {
  const points = [
    { id: 'lower', x: 250, y: 200, depth: 0.1 },
    { id: 'upper', x: 250, y: 200, depth: 0.2 },
    { id: 'roof', x: 250, y: 200, depth: 0.3 },
  ];
  const result = layoutOverviewTokens(points, { left: 0, top: 0, right: 800, bottom: 600 });
  expect(new Set(result.map(({ x, y }) => `${x},${y}`)).size).toBe(3);
  for (let index = 1; index < result.length; index++)
    expect(result[index].y - result[index - 1].y).toBeGreaterThanOrEqual(48);
  expect(points.map(({ y }) => y)).toEqual([200, 200, 200]);
});

test('location labels use the owning structure and actual floor, not the displayed map', () => {
  const spec = { id: 'keep', kind: 'building', name: 'North Keep' };
  const maps = [
    { id: 'exterior', name: 'Town', grid: { tileWorldSize: 1 } },
    {
      id: 'upper',
      name: 'Upper',
      building: { ownerMapId: 'exterior', structureId: 'keep', floor: 2 },
    },
  ];
  const geometry = { getStructures: () => [spec] };
  const world = {
    mapRevision: 0,
    listMaps: () => maps,
    getMap: (id) => maps.find((map) => map.id === id),
    getMapGeometry: () => geometry,
  };
  const locations = new CreatureLocations(world);
  expect(locations.describe({ mapId: 'upper' })).toMatchObject({
    structure: 'North Keep',
    level: 'Floor 3',
    label: 'North Keep \u00b7 Floor 3',
  });
  spec.name = 'Renamed Keep';
  locations.invalidate();
  expect(locations.describe({ mapId: 'upper' }).label).toBe('Renamed Keep \u00b7 Floor 3');
  maps[1].building.floor = 100;
  world.mapRevision++;
  expect(locations.describe({ mapId: 'upper' }).level).toBe('Battlement deck');
});

test('cellar labels say Level and outdoor creatures retain their map name', () => {
  const map = { id: 'main', name: 'Wilderness', grid: { tileWorldSize: 1 } };
  const cellar = {
    id: 'cellar',
    name: 'Deep cellar',
    building: { ownerMapId: 'main', structureId: 'cellar-1', floor: 1 },
  };
  const world = {
    mapRevision: 0,
    listMaps: () => [map, cellar],
    getMap: (id) => (id === 'main' ? map : cellar),
    getMapGeometry: () => ({
      getStructures: () => [{ id: 'cellar-1', kind: 'cellar', name: 'Vault' }],
    }),
  };
  const locations = new CreatureLocations(world);
  expect(locations.describe({ mapId: 'cellar' }).label).toBe('Vault \u00b7 Level 2');
});
