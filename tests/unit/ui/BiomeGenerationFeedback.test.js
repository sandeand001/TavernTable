import SidebarController from '../../../src/ui/SidebarController.js';
import { TerrainEngine } from '../../../src/terrain/TerrainEngine.js';
import { validateConstructionEdit } from '../../../src/campaigns/CampaignConstruction.js';
import { ErrorHandler } from '../../../src/utils/error/ErrorHandler.js';

function fixture() {
  document.body.innerHTML = `
    <button id="generate-map">Generate</button>
    <input id="biome-seed-lock" type="checkbox">
    <input id="biome-structures-toggle" type="checkbox" checked>
    <p id="biome-generation-status" role="status" aria-live="polite"></p>
    <div id="biome-menu-root">
      <button class="biome-btn selected" data-biome="castle" aria-pressed="true">Castle</button>
      <button class="biome-btn" data-biome="desertCold" aria-pressed="false">Cold Desert</button>
    </div>`;
  const engine = new TerrainEngine(25, 25);
  engine.generateBiomeElevation('castle', { seed: 42 });
  const sprite = { id: 'sprite', world: { x: 12.5, y: 0, z: 12.5 } };
  const gm = {
    terrainEngine: engine,
    campaignMapId: 'map-main',
    placedTokens: [sprite],
    spatial: { tileWorldSize: 1 },
    token3DAdapter: {
      isMovementInProgress: () => false,
      getStablePlacement: (token) => ({ pose: { kind: 'ground', world: token.world } }),
    },
  };
  engine.validateGeometryEdits((geometry) => validateConstructionEdit(gm, geometry));
  window.gameManager = gm;
  const controller = new SidebarController();
  controller._wireGenerateMapButton();
  controller.selectBiome('desertCold');
  return { engine, gm, controller };
}

beforeEach(() => jest.spyOn(ErrorHandler.prototype, 'handle').mockImplementation(() => {}));
afterEach(() => {
  jest.restoreAllMocks();
  delete window.gameManager;
});
const settleClick = async () => {
  document.getElementById('generate-map').click();
  await new Promise((resolve) => setTimeout(resolve, 0));
};

test('blocked generation explains the occupied structure beside Generate and preserves the map and random seed', async () => {
  const { engine, gm } = fixture();
  const before = engine.save(),
    position = { ...gm.placedTokens[0].world };
  await settleClick();
  expect(document.getElementById('biome-generation-status').textContent).toMatch(
    /creature occupies.*move.*outside/i
  );
  expect(document.getElementById('biome-generation-status').textContent).toMatch(
    /never moved automatically/i
  );
  expect(engine.save()).toEqual(before);
  expect(gm.placedTokens[0].world).toEqual(position);
  expect(document.getElementById('generate-map').disabled).toBe(false);
});

test('after clearing the blocker, Generate replaces the castle and reports success in the same control area', async () => {
  const { engine, gm } = fixture();
  await settleClick();
  gm.placedTokens.length = 0;
  await settleClick();
  expect(document.getElementById('biome-generation-status').textContent).toMatch(
    /generated.*cold desert|generated.*desertCold/i
  );
  expect(
    engine.geometry.getStructures().every((spec) => !spec.id.startsWith('generated-castle'))
  ).toBe(true);
  expect(document.getElementById('generate-map').disabled).toBe(false);
});

test('only the selected biome is marked pressed, so palette selection is not mistaken for multiple simultaneous biomes', () => {
  fixture();
  expect(
    [...document.querySelectorAll('.biome-btn[aria-pressed="true"]')].map(
      (button) => button.dataset.biome
    )
  ).toEqual(['desertCold']);
});
