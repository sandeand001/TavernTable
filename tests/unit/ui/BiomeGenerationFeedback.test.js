import SidebarController from '../../../src/ui/SidebarController.js';
import { TerrainEngine } from '../../../src/terrain/TerrainEngine.js';
import { validateConstructionEdit } from '../../../src/campaigns/CampaignConstruction.js';
import * as campaignGeneration from '../../../src/campaigns/CampaignBiomeGeneration.js';
import { ErrorHandler } from '../../../src/utils/error/ErrorHandler.js';
import { BIOME_REPLACEMENT_WARNING_KEY } from '../../../src/ui/terrain/BiomeReplacementConfirmation.js';

const controllers = new Set();
function createSidebar() {
  const controller = new SidebarController();
  controllers.add(controller);
  return controller;
}

function fixture() {
  document.body.innerHTML = `
    <button id="generate-map">Generate</button>
    <button id="dungeon-next-layout" hidden>Next Dungeon layout</button>
    <button id="biome-apply-palette">Apply palette only</button>
    <input id="biome-seed-lock" type="checkbox">
    <input id="biome-replacement-warning" type="checkbox" checked>
    <input id="biome-structures-toggle" type="checkbox" checked>
    <p id="biome-generation-status" role="status" aria-live="polite"></p>
    <div id="biome-menu-root">
      <button class="biome-btn selected" data-biome="castle" aria-pressed="true">Castle</button>
      <button class="biome-btn" data-biome="desertCold" aria-pressed="false">Cold Desert</button>
      <button class="biome-btn" data-biome="grassland" aria-pressed="false">Grassland</button>
    </div>`;
  const engine = new TerrainEngine(25, 25);
  engine.generateBiomeElevation('castle', { seed: 42 });
  const initialTerrain = engine.save();
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
  const controller = createSidebar();
  controller._wireGenerateMapButton();
  controller.selectBiome('desertCold');
  return { engine, gm, controller, initialTerrain };
}

beforeEach(() => {
  localStorage.clear();
  delete window.richShadingSettings;
  jest.spyOn(ErrorHandler.prototype, 'handle').mockImplementation(() => {});
});
afterEach(() => {
  for (const controller of controllers) controller.dispose();
  controllers.clear();
  jest.restoreAllMocks();
  delete window.gameManager;
});
const settleClick = async () => {
  document.getElementById('generate-map').click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  document.querySelector('[data-biome-generation-review] form').requestSubmit();
  await new Promise((resolve) => setTimeout(resolve, 0));
  document.querySelector('[data-biome-replacement-confirmation] form')?.requestSubmit();
  await new Promise((resolve) => setTimeout(resolve, 0));
};

test('selecting a family and cancelling review leaves the current map and recipe untouched', async () => {
  const { engine, initialTerrain } = fixture();
  expect(engine.save()).toEqual(initialTerrain);
  document.getElementById('generate-map').click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  document.querySelector('[data-biome-generation-review] [data-cancel]').click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(engine.save()).toEqual(initialTerrain);
  expect(document.getElementById('biome-generation-status').textContent).toMatch(/cancelled/i);
});

test('declining the replacement warning preserves the current map and recipe', async () => {
  const { engine, initialTerrain } = fixture();
  const generate = jest.spyOn(campaignGeneration, 'replaceCampaignBiome');
  document.getElementById('generate-map').click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  document.querySelector('[data-biome-generation-review] form').requestSubmit();
  await new Promise((resolve) => setTimeout(resolve, 0));
  const warning = document.querySelector('[data-biome-replacement-confirmation]');
  expect(warning.textContent).toMatch(/replace.*terrain.*scenery/i);
  warning.querySelector('[data-cancel]').click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(generate).not.toHaveBeenCalled();
  expect(engine.save()).toEqual(initialTerrain);
  expect(document.getElementById('biome-generation-status').textContent).toMatch(/cancelled/i);
});

test('confirmation passes the chosen dimensions to the atomic replacement', async () => {
  const { gm } = fixture();
  const replace = jest.spyOn(campaignGeneration, 'replaceCampaignBiome').mockResolvedValue(true);
  document.getElementById('generate-map').click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  const form = document.querySelector('[data-biome-generation-review] form');
  form.querySelector('[name="gridCols"]').value = '18';
  form.querySelector('[name="gridRows"]').value = '13';
  form.requestSubmit();
  await new Promise((resolve) => setTimeout(resolve, 0));
  const warning = document.querySelector('[data-biome-replacement-confirmation]');
  expect(warning.textContent.replace(/\s+/g, ' ')).toMatch(
    /creature tokens.*character sheets.*other maps/i
  );
  warning.querySelector('form').requestSubmit();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(replace).toHaveBeenCalledWith(gm, expect.objectContaining({ biomeKey: 'desertCold' }), {
    cols: 18,
    rows: 13,
  });
});

test('the palette can still be applied without generating terrain', () => {
  const { engine, initialTerrain } = fixture();
  expect(engine.save()).toEqual(initialTerrain);
  document.getElementById('biome-apply-palette').click();
  expect(engine.biomeKey).toBe('desertCold');
  expect(engine.save().heights).toEqual(initialTerrain.heights);
  expect(engine.geometry.save()).toEqual(initialTerrain.geometry);
});

test('switching maps synchronizes the selection after the new terrain is loaded', () => {
  const { engine, gm } = fixture();
  gm.campaignMapId = 'another-map';
  window.dispatchEvent(new CustomEvent('taverntable:campaignViewStateChanged'));
  engine.setBiome('grassland', { generateIfFlat: false });
  window.dispatchEvent(new CustomEvent('taverntable:campaignViewStateChanged'));
  expect(document.querySelector('[data-biome="grassland"]').getAttribute('aria-pressed')).toBe(
    'true'
  );
});

test('generation is cancelled if the active map changes during the review', async () => {
  const { engine, gm, initialTerrain } = fixture();
  document.getElementById('generate-map').click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  gm.campaignMapId = 'another-map';
  document.querySelector('[data-biome-generation-review] form').requestSubmit();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(engine.save()).toEqual(initialTerrain);
  expect(document.getElementById('biome-generation-status').textContent).toMatch(/map changed/i);
});

test('a configured but unavailable protected key is explained before offering built-in scenery', async () => {
  const { gm } = fixture();
  gm.modelAssetCache = {
    hasProtectedAssetKeyProvider: () => true,
    verifyProtectedAssetAccess: jest.fn().mockRejectedValue(new Error('Key service unavailable')),
  };
  document.getElementById('generate-map').click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  const root = document.querySelector('[data-biome-generation-review]');
  const variant = root.querySelector('[name="variant"]');
  variant.value = 'desertHot';
  variant.dispatchEvent(new Event('change', { bubbles: true }));
  expect(gm.modelAssetCache.verifyProtectedAssetAccess).toHaveBeenCalled();
  expect(root.querySelector('[data-field="assetPack"] small').textContent).toMatch(
    /key service unavailable/i
  );
  expect(root.querySelector('[name="assetPack"]').value).toBe('standard');
  expect(root.querySelector('[name="assetPack"] option[value="pure-poly"]').disabled).toBe(true);
  root.querySelector('[data-cancel]').click();
  await new Promise((resolve) => setTimeout(resolve, 0));
});

test('a stalled key check times out and still allows built-in scenery', async () => {
  const { gm } = fixture();
  let release;
  gm.modelAssetCache = {
    hasProtectedAssetKeyProvider: () => true,
    verifyProtectedAssetAccess: () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  };
  jest.useFakeTimers();
  try {
    document.getElementById('generate-map').click();
    await jest.advanceTimersByTimeAsync(10000);
    const root = document.querySelector('[data-biome-generation-review]');
    const variant = root.querySelector('[name="variant"]');
    variant.value = 'desertHot';
    variant.dispatchEvent(new Event('change', { bubbles: true }));
    expect(root.querySelector('[data-field="assetPack"] small').textContent).toMatch(/timed out/i);
    expect(root.querySelector('[name="assetPack"]').value).toBe('standard');
    expect(root.querySelector('[name="assetPack"] option[value="pure-poly"]').disabled).toBe(true);
    release();
    await Promise.resolve();
    expect(root.querySelector('[name="assetPack"] option[value="pure-poly"]').disabled).toBe(true);
    root.querySelector('[data-cancel]').click();
  } finally {
    jest.useRealTimers();
  }
});

test('a map changed during protected key verification never opens a stale review', async () => {
  const { gm } = fixture();
  let release;
  gm.modelAssetCache = {
    hasProtectedAssetKeyProvider: () => true,
    verifyProtectedAssetAccess: () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  };
  document.getElementById('generate-map').click();
  gm.campaignMapId = 'another-map';
  release();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(document.querySelector('[data-biome-generation-review]')).toBeNull();
  expect(document.getElementById('biome-generation-status').textContent).toMatch(/map changed/i);
});

test('revoked protected access during review prevents replacing the map', async () => {
  const { engine, gm, initialTerrain } = fixture();
  const replace = jest.spyOn(campaignGeneration, 'replaceCampaignBiome');
  gm.modelAssetCache = {
    hasProtectedAssetKeyProvider: () => true,
    verifyProtectedAssetAccess: jest
      .fn()
      .mockResolvedValueOnce()
      .mockRejectedValueOnce(new Error('Protected access was revoked')),
  };
  document.getElementById('generate-map').click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  const review = document.querySelector('[data-biome-generation-review]');
  const variant = review.querySelector('[name="variant"]');
  variant.value = 'desertHot';
  variant.dispatchEvent(new Event('change', { bubbles: true }));
  expect(review.querySelector('[name="assetPack"]').value).toBe('pure-poly');
  review.querySelector('form').requestSubmit();
  await new Promise((resolve) => setTimeout(resolve, 0));
  document.querySelector('[data-biome-replacement-confirmation] form').requestSubmit();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(gm.modelAssetCache.verifyProtectedAssetAccess).toHaveBeenCalledTimes(2);
  expect(replace).not.toHaveBeenCalled();
  expect(engine.save()).toEqual(initialTerrain);
  expect(document.getElementById('biome-generation-status').textContent).toMatch(
    /access was revoked/i
  );
});

test('generation is cancelled if terrain changes while the review is open', async () => {
  const { engine } = fixture();
  document.getElementById('generate-map').click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  engine.setHeightAt(0, 0, 3);
  const edited = engine.save();
  document.querySelector('[data-biome-generation-review] form').requestSubmit();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(engine.save()).toEqual(edited);
  expect(document.getElementById('biome-generation-status').textContent).toMatch(/map changed/i);
});

test('a linked-creature failure is reported without changing the map', async () => {
  const { engine, gm } = fixture();
  const before = engine.save(),
    position = { ...gm.placedTokens[0].world };
  jest
    .spyOn(campaignGeneration, 'replaceCampaignBiome')
    .mockRejectedValue(new Error('A creature occupies a linked map'));
  await settleClick();
  expect(document.getElementById('biome-generation-status').textContent).toMatch(
    /creature occupies a linked map/i
  );
  expect(document.getElementById('biome-generation-status').textContent).toMatch(
    /resolve affected creatures/i
  );
  expect(engine.save()).toEqual(before);
  expect(gm.placedTokens[0].world).toEqual(position);
  expect(document.getElementById('generate-map').disabled).toBe(false);
});

test('the Dungeon cycle retains the room count, overrides the lock, and respects warning preferences', async () => {
  const { gm, controller } = fixture();
  const engine = new TerrainEngine(25, 25);
  engine.generateBiomeElevation('dungeon', { seed: 42, dungeonRoomCount: 8 });
  gm.terrainEngine = engine;
  controller._syncGenerationSelection();
  const cycle = document.getElementById('dungeon-next-layout');
  const lock = document.getElementById('biome-seed-lock');
  const warningToggle = document.getElementById('biome-replacement-warning');
  lock.checked = true;
  expect(cycle.hidden).toBe(false);
  expect(cycle.disabled).toBe(false);
  const replace = jest
    .spyOn(campaignGeneration, 'replaceCampaignBiome')
    .mockImplementation(async (_gm, options) => {
      engine.generateBiomeElevation('dungeon', options);
      return true;
    });
  cycle.click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  const warning = document.querySelector('[data-biome-replacement-confirmation]');
  warning.querySelector('[name="skipWarning"]').checked = true;
  warning.querySelector('form').requestSubmit();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(replace).toHaveBeenCalledWith(
    gm,
    expect.objectContaining({ biomeKey: 'dungeon', dungeonRoomCount: 8, structures: true }),
    { cols: 25, rows: 25 }
  );
  const firstSeed = engine.biomeSeed;
  expect(firstSeed).not.toBe(42);
  expect(lock.checked).toBe(true);
  expect(warningToggle.checked).toBe(false);
  cycle.click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(document.querySelector('[data-biome-replacement-confirmation]')).toBeNull();
  expect(engine.biomeSeed).not.toBe(firstSeed);
  expect(engine.generationRecipe.values.dungeonRoomCount).toBe(8);
  warningToggle.checked = true;
  warningToggle.dispatchEvent(new Event('change', { bubbles: true }));
  const before = engine.save();
  cycle.click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  document.querySelector('[data-biome-replacement-confirmation] [data-cancel]').click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(engine.save()).toEqual(before);
});

test.each([true, false])(
  'normal Dungeon generation honors seed lock = %s without repeating an unlocked layout',
  async (locked) => {
    const { gm, controller } = fixture();
    const engine = new TerrainEngine(25, 25);
    engine.generateBiomeElevation('dungeon', { seed: 42, dungeonRoomCount: 8 });
    gm.terrainEngine = engine;
    controller._syncGenerationSelection();
    document.getElementById('biome-seed-lock').checked = locked;
    jest.spyOn(Math, 'random').mockReturnValue(42 / 0x100000000);
    const replace = jest
      .spyOn(campaignGeneration, 'replaceCampaignBiome')
      .mockImplementation(async (_gm, options) => {
        engine.generateBiomeElevation('dungeon', options);
        return true;
      });
    await settleClick();
    const options = replace.mock.calls[0][1];
    expect(options.dungeonRoomCount).toBe(8);
    if (locked) expect(options.seed).toBe(42);
    else expect(options.seed).not.toBe(42);
  }
);

test('the warning toggle reflects preference changes from another tab', () => {
  fixture();
  const warning = document.getElementById('biome-replacement-warning');
  localStorage.setItem(BIOME_REPLACEMENT_WARNING_KEY, 'true');
  window.dispatchEvent(new StorageEvent('storage', { key: BIOME_REPLACEMENT_WARNING_KEY }));
  expect(warning.checked).toBe(false);
  localStorage.removeItem(BIOME_REPLACEMENT_WARNING_KEY);
  window.dispatchEvent(new StorageEvent('storage', { key: BIOME_REPLACEMENT_WARNING_KEY }));
  expect(warning.checked).toBe(true);
});

test('a failed warning preference change is reported and leaves the warning enabled', () => {
  fixture();
  const warning = document.getElementById('biome-replacement-warning');
  jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('Storage unavailable');
  });
  warning.checked = false;
  warning.dispatchEvent(new Event('change', { bubbles: true }));
  expect(warning.checked).toBe(true);
  expect(document.getElementById('biome-generation-status').textContent).toMatch(/could not save/i);
});

test('cycling rejects a stale map if the active view changes while the warning is open', async () => {
  const { gm, controller } = fixture();
  const engine = new TerrainEngine(25, 25);
  engine.generateBiomeElevation('dungeon', { seed: 42, dungeonRoomCount: 8 });
  gm.terrainEngine = engine;
  controller._syncGenerationSelection();
  const replace = jest.spyOn(campaignGeneration, 'replaceCampaignBiome');
  document.getElementById('dungeon-next-layout').click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  gm.campaignMapId = 'other-map';
  document.querySelector('[data-biome-replacement-confirmation] form').requestSubmit();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(replace).not.toHaveBeenCalled();
  expect(engine.biomeSeed).toBe(42);
  expect(document.getElementById('biome-generation-status').textContent).toMatch(/map changed/i);
});

test('a post-save problem is not reported as an uncommitted generation', async () => {
  fixture();
  jest.spyOn(campaignGeneration, 'replaceCampaignBiome').mockRejectedValue(
    Object.assign(new Error('The generated map was saved. Reload the campaign.'), {
      committed: true,
    })
  );
  await settleClick();
  const status = document.getElementById('biome-generation-status').textContent;
  expect(status).toMatch(/map was saved.*reload/i);
  expect(status).not.toMatch(/cannot generate/i);
});

test('a successful confirmed replacement reports the new biome', async () => {
  const { engine } = fixture();
  jest
    .spyOn(campaignGeneration, 'replaceCampaignBiome')
    .mockImplementation(async (_gm, options) => {
      engine.setBiome(options.biomeKey, { generateIfFlat: false });
      return true;
    });
  await settleClick();
  expect(document.getElementById('biome-generation-status').textContent).toMatch(
    /generated.*cold desert|generated.*desertCold/i
  );
  expect(document.getElementById('generate-map').disabled).toBe(false);
});

test('a linked-area generation error does not incorrectly suggest moving creatures', async () => {
  fixture();
  jest
    .spyOn(campaignGeneration, 'replaceCampaignBiome')
    .mockRejectedValue(new Error('Generation would remove linked cavern areas'));
  await settleClick();
  const status = document.getElementById('biome-generation-status').textContent;
  expect(status).toMatch(/linked cavern areas/i);
  expect(status).not.toMatch(/move or remove creatures/i);
});

test('only the selected biome is marked pressed, so palette selection is not mistaken for multiple simultaneous biomes', () => {
  fixture();
  expect(
    [...document.querySelectorAll('.biome-btn[aria-pressed="true"]')].map(
      (button) => button.dataset.biome
    )
  ).toEqual(['desertCold']);
});

test('the picker condenses legacy biomes into thirteen families and restores a selected key', async () => {
  document.body.innerHTML = '<div id="biome-menu-root"></div>';
  const engine = new TerrainEngine(25, 25);
  engine.generateBiomeElevation('crystalSpires', { seed: 42 });
  window.gameManager = { terrainEngine: engine };
  const controller = createSidebar();
  controller.buildBiomeMenuSafely();
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(document.querySelectorAll('.biome-btn')).toHaveLength(13);
  const underground = document.querySelector('[data-biome-family="underground"]');
  expect(underground.dataset.biomeVariants.split('|')).toContain('crystalSpires');
  controller.selectBiome('crystalSpires');
  expect(underground.getAttribute('aria-pressed')).toBe('true');
});

test('ordinary underground biomes hide tree placeables from the manual palette', async () => {
  document.body.innerHTML = '<div id="terrain-placeables-root"></div>';
  const engine = new TerrainEngine(25, 25);
  engine.setBiome('cavern', { generateIfFlat: false });
  window.gameManager = { terrainEngine: engine };
  const controller = createSidebar();
  controller.buildTerrainPlaceablesMenuSafely();
  await new Promise((resolve) => setTimeout(resolve, 0));

  const trees = [...document.querySelectorAll('.placeable-btn')].filter(
    ({ dataset }) =>
      dataset.placeable.startsWith('tree-') || dataset.placeable.startsWith('family-')
  );
  expect(trees.length).toBeGreaterThan(0);
  expect(trees.every((button) => button.hidden && button.disabled)).toBe(true);
  expect(document.querySelector('[data-placeable="mushroom-common"]').hidden).toBe(false);
});
