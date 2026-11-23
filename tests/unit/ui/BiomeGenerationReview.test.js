import { openBiomeGenerationReview } from '../../../src/ui/terrain/BiomeGenerationReview.js';
import { BIOME_GENERATION_FAMILIES } from '../../../src/config/biome/BiomeGenerationFamilies.js';

test.each(BIOME_GENERATION_FAMILIES.map((family) => [family.label, family.variants[0].key]))(
  '%s generation reviews accept explicit grid dimensions',
  async (_label, biomeKey) => {
    const pending = openBiomeGenerationReview({ biomeKey, gridSize: { cols: 31, rows: 22 } });
    const root = document.querySelector('[data-biome-generation-review]');
    const width = root.querySelector('[name="gridCols"]');
    const height = root.querySelector('[name="gridRows"]');
    expect(width.value).toBe('31');
    expect(height.value).toBe('22');
    width.value = '18';
    height.value = '13';
    root.querySelector('form').requestSubmit();
    await expect(pending).resolves.toMatchObject({ gridSize: { cols: 18, rows: 13 } });
  }
);

test('the family generation review exposes editable defaults and normalizes the result', async () => {
  const pending = openBiomeGenerationReview({
    biomeKey: 'castle',
    biomeName: 'Castle / Fortress',
  });
  const root = document.querySelector('[data-biome-generation-review]');
  expect(root).not.toBeNull();
  expect(root.getAttribute('role')).toBe('dialog');
  expect(root.querySelectorAll('select:not(:disabled)')).toHaveLength(4);
  expect(root.querySelector('[name="footprint"]')).toBeNull();
  root.querySelector('[name="variant"]').value = 'ruinedCastle';
  root.querySelector('[name="layout"]').value = 'citadel';
  root.querySelector('[name="outskirts"]').value = 'none';
  root.querySelector('[name="density"]').value = 'sparse';
  root.querySelector('form').requestSubmit();

  await expect(pending).resolves.toEqual({
    biomeKey: 'ruinedCastle',
    gridSize: { cols: 25, rows: 25 },
    layoutFamily: 'citadel',
    outerWards: false,
    densityMultiplier: 0.55,
  });
  expect(document.querySelector('[data-biome-generation-review]')).toBeNull();
});

test('canceling the review returns no generation options', async () => {
  const pending = openBiomeGenerationReview({ biomeKey: 'grassland' });
  document.querySelector('[data-cancel]').click();
  await expect(pending).resolves.toBeNull();
});

test('verified protected scenery is preferred for new deserts while built-in scenery remains selectable', async () => {
  const pending = openBiomeGenerationReview({
    biomeKey: 'desertHot',
    protectedAssetsAvailable: true,
  });
  const root = document.querySelector('[data-biome-generation-review]');
  const source = root.querySelector('[name="assetPack"]');
  const density = root.querySelector('[name="density"]');
  expect(source.value).toBe('pure-poly');
  expect(density.disabled).toBe(false);
  source.value = 'standard';
  source.dispatchEvent(new Event('change', { bubbles: true }));
  expect(density.disabled).toBe(true);
  source.value = 'pure-poly';
  source.dispatchEvent(new Event('change', { bubbles: true }));
  expect(density.disabled).toBe(false);
  density.value = 'dense';
  root.querySelector('form').requestSubmit();
  await expect(pending).resolves.toMatchObject({
    biomeKey: 'desertHot',
    assetPack: 'pure-poly',
    densityMultiplier: 1.65,
  });
});

test('saved scenery choices survive verified access and switching between variants', async () => {
  const pending = openBiomeGenerationReview({
    biomeKey: 'cavern',
    generationRecipe: { version: 1, biomeKey: 'cavern', values: {} },
    protectedAssetsAvailable: true,
  });
  const root = document.querySelector('[data-biome-generation-review]');
  const source = root.querySelector('[name="assetPack"]');
  const variant = root.querySelector('[name="variant"]');
  expect(source.value).toBe('standard');
  variant.value = 'crystalFields';
  variant.dispatchEvent(new Event('change', { bubbles: true }));
  expect(source.value).toBe('pure-poly');
  variant.value = 'cavern';
  variant.dispatchEvent(new Event('change', { bubbles: true }));
  expect(source.value).toBe('standard');
  root.querySelector('form').requestSubmit();
  const result = await pending;
  expect(result).not.toHaveProperty('assetPack');
});

test('a saved protected scenery choice cannot be silently changed when keys are unavailable', async () => {
  const pending = openBiomeGenerationReview({
    biomeKey: 'cavern',
    generationRecipe: { version: 1, biomeKey: 'cavern', values: { assetPack: 'pure-poly' } },
  });
  const root = document.querySelector('[data-biome-generation-review]');
  const source = root.querySelector('[name="assetPack"]');
  expect(source.value).toBe('pure-poly');
  expect(source.options[source.selectedIndex].disabled).toBe(true);
  expect(root.querySelector('form').checkValidity()).toBe(false);
  source.value = 'standard';
  source.dispatchEvent(new Event('change', { bubbles: true }));
  root.querySelector('form').requestSubmit();
  const result = await pending;
  expect(result).not.toHaveProperty('assetPack');
});

test('site-castle variants hide unsupported plan and ward controls', async () => {
  const pending = openBiomeGenerationReview({ biomeKey: 'castle' });
  const root = document.querySelector('[data-biome-generation-review]');
  root.querySelector('[name="variant"]').value = 'cliffsideCastle';
  root.querySelector('[name="variant"]').dispatchEvent(new Event('change', { bubbles: true }));
  expect(root.querySelector('[data-field="layout"]').hidden).toBe(true);
  expect(root.querySelector('[data-field="outskirts"]').hidden).toBe(true);
  root.querySelector('form').requestSubmit();
  const result = await pending;
  expect(result).toEqual({
    biomeKey: 'cliffsideCastle',
    gridSize: { cols: 25, rows: 25 },
    densityMultiplier: 1,
  });
});

test('Dungeon hides natural-cavern exits and flora density in its generation review', async () => {
  const pending = openBiomeGenerationReview({ biomeKey: 'cavern' });
  const root = document.querySelector('[data-biome-generation-review]');
  root.querySelector('[name="variant"]').value = 'dungeon';
  root.querySelector('[name="variant"]').dispatchEvent(new Event('change', { bubbles: true }));
  expect(root.querySelector('[data-field="entrances"]').hidden).toBe(true);
  expect(root.querySelector('[data-field="density"]').hidden).toBe(true);
  expect(root.querySelector('[data-field="cavernNetwork"]').hidden).toBe(true);
  const rooms = root.querySelector('[name="dungeonRoomCount"]');
  expect(rooms.value).toBe('6');
  expect(rooms.closest('[data-field]').hidden).toBe(false);
  rooms.value = '9';
  expect(root.querySelector('button[type="submit"]').textContent).toBe('Generate Dungeon');
  root.querySelector('form').requestSubmit();
  await expect(pending).resolves.toEqual({
    biomeKey: 'dungeon',
    dungeonRoomCount: 9,
    gridSize: { cols: 25, rows: 25 },
  });
});

test('a saved Dungeon room count reopens without leaking into natural cavern choices', async () => {
  const pending = openBiomeGenerationReview({
    biomeKey: 'dungeon',
    generationRecipe: { version: 1, biomeKey: 'dungeon', values: { dungeonRoomCount: 8 } },
  });
  const root = document.querySelector('[data-biome-generation-review]');
  expect(root.querySelector('[name="dungeonRoomCount"]').value).toBe('8');
  root.querySelector('[name="variant"]').value = 'cavern';
  root.querySelector('[name="variant"]').dispatchEvent(new Event('change', { bubbles: true }));
  expect(root.querySelector('[data-field="dungeonRoomCount"]').hidden).toBe(true);
  root.querySelector('form').requestSubmit();
  const result = await pending;
  expect(result.biomeKey).toBe('cavern');
  expect(result).not.toHaveProperty('dungeonRoomCount');
});

test('switching into the saved Dungeon variant restores its room count without overwriting edits', async () => {
  const pending = openBiomeGenerationReview({
    biomeKey: 'cavern',
    generationRecipe: { version: 1, biomeKey: 'dungeon', values: { dungeonRoomCount: 8 } },
  });
  const root = document.querySelector('[data-biome-generation-review]');
  const variant = root.querySelector('[name="variant"]');
  const rooms = root.querySelector('[name="dungeonRoomCount"]');
  variant.value = 'dungeon';
  variant.dispatchEvent(new Event('change', { bubbles: true }));
  expect(rooms.value).toBe('8');
  rooms.value = '10';
  rooms.dispatchEvent(new Event('change', { bubbles: true }));
  variant.value = 'cavern';
  variant.dispatchEvent(new Event('change', { bubbles: true }));
  variant.value = 'dungeon';
  variant.dispatchEvent(new Event('change', { bubbles: true }));
  expect(rooms.value).toBe('10');
  root.querySelector('form').requestSubmit();
  await expect(pending).resolves.toMatchObject({ biomeKey: 'dungeon', dungeonRoomCount: 10 });
});

test('Dungeon review blocks a room count that cannot fit before asking to replace the map', async () => {
  const pending = openBiomeGenerationReview({
    biomeKey: 'dungeon',
    gridSize: { cols: 12, rows: 12 },
  });
  const root = document.querySelector('[data-biome-generation-review]');
  const rooms = root.querySelector('[name="dungeonRoomCount"]');
  rooms.value = '16';
  rooms.dispatchEvent(new Event('change', { bubbles: true }));
  expect(rooms.validity.valid).toBe(false);
  expect(rooms.validationMessage).toMatch(/up to 6 rooms.*larger grid or fewer rooms/i);
  expect(root.querySelector('form').checkValidity()).toBe(false);
  rooms.value = '6';
  rooms.dispatchEvent(new Event('change', { bubbles: true }));
  root.querySelector('form').requestSubmit();
  await expect(pending).resolves.toMatchObject({ biomeKey: 'dungeon', dungeonRoomCount: 6 });
});

test('a structure-free Dungeon does not require room capacity', async () => {
  const pending = openBiomeGenerationReview({
    biomeKey: 'dungeon',
    gridSize: { cols: 8, rows: 8 },
    structuresEnabled: false,
  });
  const root = document.querySelector('[data-biome-generation-review]');
  expect(root.querySelector('[data-field="dungeonRoomCount"]').hidden).toBe(true);
  root.querySelector('form').requestSubmit();
  const result = await pending;
  expect(result).toMatchObject({ biomeKey: 'dungeon', gridSize: { cols: 8, rows: 8 } });
  expect(result).not.toHaveProperty('dungeonRoomCount');
});

test('natural cavern review selects chamber count and distinct outside entrances', async () => {
  const pending = openBiomeGenerationReview({
    biomeKey: 'cavern',
    cavernDefaults: { totalChambers: 2, outsideSides: ['north'], outsideMode: 'separate' },
  });
  const root = document.querySelector('[data-biome-generation-review]');
  expect(root.querySelector('[name="totalChambers"]').value).toBe('2');
  expect(root.querySelector('[name="outsideSide"][value="north"]').checked).toBe(true);
  root.querySelector('[name="totalChambers"]').value = '4';
  root.querySelector('[name="outsideSide"][value="south"]').checked = true;
  root.querySelector('[name="outsideMode"]').value = 'shared';
  root.querySelector('form').requestSubmit();
  await expect(pending).resolves.toMatchObject({
    cavernNetwork: {
      totalChambers: 4,
      outsideSides: ['north', 'south'],
      outsideMode: 'shared',
    },
  });
});

test('moisture is hidden when a variant cannot use it, and returns for supported variants', async () => {
  const pending = openBiomeGenerationReview({ biomeKey: 'desertHot' });
  const root = document.querySelector('[data-biome-generation-review]');
  expect(root.querySelector('[data-field="moisture"]').hidden).toBe(false);
  root.querySelector('[name="variant"]').value = 'sandDunes';
  root.querySelector('[name="variant"]').dispatchEvent(new Event('change', { bubbles: true }));
  expect(root.querySelector('[data-field="moisture"]').hidden).toBe(true);
  expect(root.querySelector('[name="moisture"]').disabled).toBe(true);
  root.querySelector('[name="variant"]').value = 'desertHot';
  root.querySelector('[name="variant"]').dispatchEvent(new Event('change', { bubbles: true }));
  expect(root.querySelector('[data-field="moisture"]').hidden).toBe(false);
  root.querySelector('[data-cancel]').click();
  await pending;
});

test('surface character is offered only for variants with a calibrated implementation', async () => {
  const pending = openBiomeGenerationReview({ biomeKey: 'mountain' });
  const root = document.querySelector('[data-biome-generation-review]');
  expect(root.querySelector('[data-field="roughness"]').hidden).toBe(true);
  root.querySelector('[name="variant"]').value = 'cedarHighlands';
  root.querySelector('[name="variant"]').dispatchEvent(new Event('change', { bubbles: true }));
  expect(root.querySelector('[data-field="roughness"]').hidden).toBe(false);
  root.querySelector('[data-cancel]').click();
  await pending;
});

test('salt flats expose terrain relief and restore its saved value', async () => {
  const pending = openBiomeGenerationReview({
    biomeKey: 'saltFlats',
    generationRecipe: { version: 1, biomeKey: 'saltFlats', values: { relief: 1.4 } },
  });
  const root = document.querySelector('[data-biome-generation-review]');
  const relief = root.querySelector('[name="relief"]');
  expect(relief.disabled).toBe(false);
  expect(relief.closest('[data-field]').hidden).toBe(false);
  expect(relief.value).toBe('dramatic');
  root.querySelector('form').requestSubmit();
  await expect(pending).resolves.toMatchObject({
    biomeKey: 'saltFlats',
    relief: 1.4,
    saltFlatReliefVersion: 1,
  });
});

test('opening Salt Flats relief preserves an untouched custom legacy value', async () => {
  const pending = openBiomeGenerationReview({
    biomeKey: 'saltFlats',
    generationRecipe: { version: 1, biomeKey: 'saltFlats', values: { relief: 1.35 } },
  });
  const root = document.querySelector('[data-biome-generation-review]');
  expect(root.querySelector('[name="relief"]').value).toBe('dramatic');
  root.querySelector('form').requestSubmit();
  await expect(pending).resolves.toMatchObject({
    biomeKey: 'saltFlats',
    relief: 1.35,
    saltFlatReliefVersion: 1,
  });
});

test('changing Salt Flats relief replaces a custom legacy value', async () => {
  const pending = openBiomeGenerationReview({
    biomeKey: 'saltFlats',
    generationRecipe: { version: 1, biomeKey: 'saltFlats', values: { relief: 1.35 } },
  });
  const root = document.querySelector('[data-biome-generation-review]');
  const relief = root.querySelector('[name="relief"]');
  relief.value = 'gentle';
  relief.dispatchEvent(new Event('change', { bubbles: true }));
  root.querySelector('form').requestSubmit();
  await expect(pending).resolves.toMatchObject({
    biomeKey: 'saltFlats',
    relief: 0.7,
    saltFlatReliefVersion: 1,
  });
});

test('switching to Salt Flats uses the relief shown in the review', async () => {
  const pending = openBiomeGenerationReview({
    biomeKey: 'desertHot',
    generationRecipe: { version: 1, biomeKey: 'saltFlats', values: { relief: 1.35 } },
  });
  const root = document.querySelector('[data-biome-generation-review]');
  const variant = root.querySelector('[name="variant"]');
  variant.value = 'saltFlats';
  variant.dispatchEvent(new Event('change', { bubbles: true }));
  expect(root.querySelector('[name="relief"]').value).toBe('balanced');
  root.querySelector('form').requestSubmit();
  await expect(pending).resolves.toMatchObject({ biomeKey: 'saltFlats', relief: 1 });
});

test.each([
  ['desertHot', 'oasis'],
  ['crystalFields', 'crystalSpires'],
  ['ocean', 'coast'],
])(
  'asset density is unavailable for %s but becomes available for %s',
  async (emptyVariant, populatedVariant) => {
    const pending = openBiomeGenerationReview({ biomeKey: emptyVariant });
    const root = document.querySelector('[data-biome-generation-review]');
    const density = root.querySelector('[name="density"]');
    expect(density.disabled).toBe(true);
    expect(density.closest('[data-field]').hidden).toBe(true);

    const variant = root.querySelector('[name="variant"]');
    variant.value = populatedVariant;
    variant.dispatchEvent(new Event('change', { bubbles: true }));
    expect(density.disabled).toBe(false);
    expect(density.closest('[data-field]').hidden).toBe(false);
    density.value = 'dense';
    root.querySelector('form').requestSubmit();
    await expect(pending).resolves.toMatchObject({
      biomeKey: populatedVariant,
      densityMultiplier: 1.65,
    });
  }
);

test.each([0, 1.35])(
  'a hidden legacy asset density of %s is retained for the same biome',
  async (densityMultiplier) => {
    const pending = openBiomeGenerationReview({
      biomeKey: 'crystalFields',
      generationRecipe: {
        version: 1,
        biomeKey: 'crystalFields',
        values: { densityMultiplier },
      },
    });
    const root = document.querySelector('[data-biome-generation-review]');
    expect(root.querySelector('[data-field="density"]').hidden).toBe(true);
    root.querySelector('form').requestSubmit();
    await expect(pending).resolves.toMatchObject({
      biomeKey: 'crystalFields',
      densityMultiplier,
    });
  }
);

test('switching empty biomes does not carry an unavailable legacy density to the new variant', async () => {
  const pending = openBiomeGenerationReview({
    biomeKey: 'ocean',
    generationRecipe: {
      version: 1,
      biomeKey: 'ocean',
      values: { densityMultiplier: 1.35 },
    },
  });
  const root = document.querySelector('[data-biome-generation-review]');
  const variant = root.querySelector('[name="variant"]');
  variant.value = 'coralReef';
  variant.dispatchEvent(new Event('change', { bubbles: true }));
  root.querySelector('form').requestSubmit();
  await expect(pending).resolves.toMatchObject({ biomeKey: 'coralReef', densityMultiplier: 1 });
});

test('a hidden legacy moisture value is retained when regenerating the same variant', async () => {
  const pending = openBiomeGenerationReview({
    biomeKey: 'ocean',
    generationRecipe: {
      version: 1,
      biomeKey: 'ocean',
      values: { waterBias: 0.25 },
    },
  });
  const root = document.querySelector('[data-biome-generation-review]');
  expect(root.querySelector('[data-field="moisture"]').hidden).toBe(true);
  root.querySelector('form').requestSubmit();
  await expect(pending).resolves.toMatchObject({ biomeKey: 'ocean', waterBias: 0.25 });
});

test('a hidden legacy surface setting is retained when regenerating the same variant', async () => {
  const pending = openBiomeGenerationReview({
    biomeKey: 'mountain',
    generationRecipe: {
      version: 1,
      biomeKey: 'mountain',
      values: { roughness: 1.35 },
    },
  });
  const root = document.querySelector('[data-biome-generation-review]');
  expect(root.querySelector('[data-field="roughness"]').hidden).toBe(true);
  root.querySelector('form').requestSubmit();
  await expect(pending).resolves.toMatchObject({ biomeKey: 'mountain', roughness: 1.35 });
});

test('switching variants does not carry an unavailable legacy moisture value to the new variant', async () => {
  const pending = openBiomeGenerationReview({
    biomeKey: 'ocean',
    generationRecipe: {
      version: 1,
      biomeKey: 'ocean',
      values: { waterBias: 0.25 },
    },
  });
  const root = document.querySelector('[data-biome-generation-review]');
  root.querySelector('[name="variant"]').value = 'coralReef';
  root.querySelector('[name="variant"]').dispatchEvent(new Event('change', { bubbles: true }));
  root.querySelector('form').requestSubmit();
  await expect(pending).resolves.toMatchObject({ biomeKey: 'coralReef', waterBias: 0 });
});

test.each([
  [-0.25, 'wet'],
  [0.25, 'dry'],
])('saved moisture %s reopens as %s and keeps its numeric value', async (waterBias, choice) => {
  const pending = openBiomeGenerationReview({
    biomeKey: 'wetlands',
    generationRecipe: {
      version: 1,
      biomeKey: 'wetlands',
      values: { waterBias },
    },
  });
  const root = document.querySelector('[data-biome-generation-review]');
  expect(root.querySelector('[name="moisture"]').value).toBe(choice);
  root.querySelector('form').requestSubmit();
  await expect(pending).resolves.toMatchObject({ biomeKey: 'wetlands', waterBias });
});

test('saved generation values reopen as the review defaults', async () => {
  const pending = openBiomeGenerationReview({
    biomeKey: 'castle',
    generationRecipe: {
      version: 1,
      biomeKey: 'castle',
      values: {
        canvasScale: 1.4,
        layoutFamily: 'palace',
        outerWards: false,
        densityMultiplier: 0.55,
      },
    },
  });
  const root = document.querySelector('[data-biome-generation-review]');
  expect(root.querySelector('[name="footprint"]')).toBeNull();
  expect(root.querySelector('[name="layout"]').value).toBe('palace');
  expect(root.querySelector('[name="outskirts"]').value).toBe('none');
  expect(root.querySelector('[name="density"]').value).toBe('sparse');
  root.querySelector('[data-cancel]').click();
  await pending;
});

test.each(['4', '101', '7.5', ''])('invalid grid width %s keeps the review open', async (width) => {
  const pending = openBiomeGenerationReview({ biomeKey: 'grassland' });
  const root = document.querySelector('[data-biome-generation-review]');
  root.querySelector('[name="gridCols"]').value = width;
  root.querySelector('form').requestSubmit();
  expect(root.isConnected).toBe(true);
  expect(root.querySelector('[name="gridCols"]').checkValidity()).toBe(false);
  root.querySelector('[data-cancel]').click();
  await expect(pending).resolves.toBeNull();
});
