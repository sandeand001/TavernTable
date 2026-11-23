import { createTerrainWorld, floraContext } from '../../helpers/terrainWorld.js';
import { BIOME_FLORA_PROFILES } from '../../../src/config/terrain/FloraProfiles.js';
import { ALL_BIOMES } from '../../../src/config/biome/BiomeConstants.js';
import {
  autoPopulateBiomeFlora,
  planBiomePopulation,
} from '../../../src/terrain/flora/BiomePopulation.js';
import { TerrainEngine } from '../../../src/terrain/TerrainEngine.js';
import {
  cavernEntranceCells,
  cavernPassageCells,
  naturalCavernRoutes,
} from '../../../src/terrain/generation/CavernInteriors.js';
import { isAssetAllowedInBiome } from '../../../src/config/assets/BiomeAssetMatrix.js';
import { getPurePolyAsset } from '../../../src/config/assets/PurePolyAssets.js';
import { blocksCreatureMovement } from '../../../src/terrain/PlaceableCollision.js';
import { TerrainGeometry } from '../../../src/terrain/TerrainGeometry.js';
import { buildSurfaceRange, getSurfaceRoute } from '../../../src/terrain/SurfaceNavigation.js';

function generate(biomeKey, seed = 12345) {
  const placements = [];
  const world = createTerrainWorld(25, 25, {
    addPlaceable: (item) => {
      placements.push(item);
      return Promise.resolve();
    },
    purgeAll: () => {
      placements.length = 0;
    },
  });
  try {
    expect(world.engine.generateBiomeElevation(biomeKey, { seed })).toBe(true);
    return placements;
  } finally {
    world.dispose();
  }
}

describe('Biome-appropriate exotic populations', () => {
  test.each([
    ['cavern', 'formation'],
    ['cavern', 'pebble'],
    ['crystalFields', 'crystal'],
    ['crystalSpires', 'crystal'],
    ['desertHot', 'cactus'],
    ['sandDunes', 'cactus'],
    ['thornscrub', 'cactus'],
    ['fungalGrove', 'fungus'],
    ['grassland', 'grass'],
    ['forestTemperate', 'fungus'],
    ['forestConifer', 'tree'],
    ['mountain', 'tree'],
    ['screeSlope', 'pebble'],
    ['hills', 'tree'],
    ['deadForest', 'tree'],
  ])('%s uses suitable protected %s models only when selected', (biomeKey, kind) => {
    const engine = new TerrainEngine(25, 25);
    const options = { seed: 42, densityMultiplier: 1.65, assetPack: 'pure-poly' };
    const first = engine.planBiomeGeneration(biomeKey, options);
    const purchased = first.placements.filter(({ modelKey }) => getPurePolyAsset(modelKey));
    expect(purchased.some(({ modelKey }) => getPurePolyAsset(modelKey).kind === kind)).toBe(true);
    expect(purchased.every(({ placeableId }) => isAssetAllowedInBiome(placeableId, biomeKey))).toBe(
      true
    );
    expect(purchased.some(({ modelKey }) => getPurePolyAsset(modelKey).kind === 'prop')).toBe(
      false
    );
    expect(
      purchased.every(({ modelKey }) =>
        getPurePolyAsset(modelKey).generatedBiomes.includes(biomeKey)
      )
    ).toBe(true);
    expect(first.placements.some(({ modelKey }) => /torch|lantern|mine-cart/i.test(modelKey))).toBe(
      false
    );
    expect(engine.planBiomeGeneration(biomeKey, options).placements).toEqual(first.placements);
    const legacy = engine.planBiomeGeneration(biomeKey, { seed: 42, densityMultiplier: 1.65 });
    expect(legacy.placements.some(({ modelKey }) => getPurePolyAsset(modelKey))).toBe(false);
    expect(first.generationRecipe.values.assetPack).toBe('pure-poly');
  });

  test.each([
    'cavern',
    'crystalFields',
    'crystalSpires',
    'desertHot',
    'sandDunes',
    'grassland',
    'screeSlope',
  ])('%s protected scenery density increases across representative seeds', (biomeKey) => {
    const engine = new TerrainEngine(25, 25);
    for (const seed of [1, 42, 99]) {
      const count = (densityMultiplier) =>
        engine.planBiomeGeneration(biomeKey, {
          seed,
          densityMultiplier,
          assetPack: 'pure-poly',
        }).placements.length;
      expect(count(1.65)).toBeGreaterThan(count(0.55));
    }
  });

  test('protected Scree Slope uses exposed stone rather than woodland trees', () => {
    const engine = new TerrainEngine(25, 25);
    const plan = engine.planBiomeGeneration('screeSlope', {
      seed: 42,
      densityMultiplier: 1.65,
      assetPack: 'pure-poly',
    });
    expect(plan.placements.length).toBeGreaterThan(0);
    expect(
      plan.placements.every(({ modelKey }) => getPurePolyAsset(modelKey)?.kind === 'pebble')
    ).toBe(true);
  });

  test('protected Dead Forest scenery includes varied purchased leafless trees', () => {
    const engine = new TerrainEngine(25, 25);
    const placements = [1, 42, 99].flatMap(
      (seed) =>
        engine.planBiomeGeneration('deadForest', {
          seed,
          densityMultiplier: 1.65,
          assetPack: 'pure-poly',
        }).placements
    );
    const leafless = placements.filter(({ modelKey }) =>
      modelKey.startsWith('pure-poly-leafless-tree-')
    );
    expect(new Set(leafless.map(({ modelKey }) => modelKey)).size).toBeGreaterThanOrEqual(3);
    expect(leafless.length).toBeGreaterThanOrEqual(placements.length / 5);
    expect(placements.some(({ modelKey }) => !getPurePolyAsset(modelKey))).toBe(true);
  });

  test.each([undefined, 'pure-poly'])(
    'Dead Forest %s scenery excludes the crimson-leafed legacy tree',
    (assetPack) => {
      const engine = new TerrainEngine(25, 25);
      const placements = [1, 42, 99].flatMap(
        (seed) =>
          engine.planBiomeGeneration('deadForest', {
            seed,
            densityMultiplier: 1.65,
            assetPack,
          }).placements
      );
      expect(placements.length).toBeGreaterThan(0);
      expect(placements.some(({ modelKey }) => modelKey === 'twisted-bare-1')).toBe(false);
    }
  );

  test('fungal groves use purchased mushroom clusters without scattering them in natural caves', () => {
    const engine = new TerrainEngine(25, 25);
    const options = { seed: 42, densityMultiplier: 1.65, assetPack: 'pure-poly' };
    const grove = engine.planBiomeGeneration('fungalGrove', options);
    const cave = engine.planBiomeGeneration('cavern', options);
    expect(
      grove.placements.some(({ modelKey }) => modelKey.startsWith('pure-poly-mushroom-cluster-'))
    ).toBe(true);
    expect(
      cave.placements.some(({ modelKey }) => modelKey.startsWith('pure-poly-mushroom-cluster-'))
    ).toBe(false);
  });

  test('fungal density uses only eligible floor cells and retries rejected candidates', () => {
    const terrainEngine = {
      cols: 20,
      rows: 20,
      cavern: { version: 6, exits: ['south'] },
      getHeightAt: () => -8,
      geometry: {
        getStructures: () => [],
        save: () => ({
          volumes: [
            {
              source: 'generated',
              layerId: 'approach',
              bounds: { min: { x: 0, z: 0 }, max: { x: 40, z: 100 } },
            },
          ],
        }),
      },
    };
    const context = {
      gameManager: { cols: 20, rows: 20, terrainEngine },
      getTreeDensityMultiplier: () => 1,
    };
    const placements = planBiomePopulation(context, 'fungalGrove', 42);
    const passages = new Set(cavernEntranceCells('south', 20, 20).map(({ x, z }) => `${x}:${z}`));
    let eligible = 0;
    for (let y = 0; y < 20; y++)
      for (let x = 9; x < 20; x++) if (!passages.has(`${x}:${y}`)) eligible++;
    expect(placements).toHaveLength(Math.floor(eligible * 0.32));
    expect(placements.every(({ gridX }) => gridX >= 9)).toBe(true);
  });

  test.each(['mysticGrove', 'feywildBloom', 'astralPlateau', 'arcaneLeyNexus'])(
    '%s generates concrete, suitable spectral family models deterministically',
    (biomeKey) => {
      const engine = new TerrainEngine(30, 30);
      const first = engine.planBiomeGeneration(biomeKey, { seed: 42 }).placements;
      const spectralTrees = first.filter(({ placeableId }) =>
        /^tree-thick-.-spectral$/.test(placeableId)
      );
      expect(spectralTrees.length).toBeGreaterThan(0);
      expect(
        spectralTrees.every(({ placeableId }) => isAssetAllowedInBiome(placeableId, biomeKey))
      ).toBe(true);
      expect(engine.planBiomeGeneration(biomeKey, { seed: 42 }).placements).toEqual(first);
    }
  );

  test.each(['cavern', 'crystalSpires'])(
    '%s dense generation produces natural clusters and a substantial density increase',
    (biomeKey) => {
      const engine = new TerrainEngine(25, 25);
      const formations = (densityMultiplier) =>
        engine
          .planBiomeGeneration(biomeKey, { seed: 42, densityMultiplier })
          .placements.filter(({ modelKey }) =>
            ['source-cave-stalagmite', 'source-cave-column'].includes(modelKey)
          );
      const normal = formations(1);
      const dense = formations(1.65);
      expect(formations(0)).toEqual([]);
      expect(dense.length).toBeGreaterThanOrEqual(35);
      expect(dense.length).toBeGreaterThan(normal.length * 1.3);
      const clustered = dense.filter((item) =>
        dense.some(
          (other) =>
            other !== item && Math.hypot(item.gridX - other.gridX, item.gridY - other.gridY) <= 2
        )
      );
      expect(clustered.length / dense.length).toBeGreaterThanOrEqual(0.6);
      expect(formations(1.65)).toEqual(dense);
    }
  );

  test('dense Cavern scenery no longer leaves every old straight entrance strip barren', () => {
    const engine = new TerrainEngine(25, 25);
    const plan = engine.planBiomeGeneration('cavern', { seed: 42, densityMultiplier: 1.65 });
    const oldStrips = new Set(
      plan.cavern.exits.flatMap((side) =>
        cavernPassageCells(side, 25, 25).map(({ x, z }) => `${x}:${z}`)
      )
    );
    const formations = plan.placements.filter(({ modelKey }) =>
      /^source-cave-(stalagmite|column)$/.test(modelKey || '')
    );
    expect(formations.some(({ gridX, gridY }) => oldStrips.has(`${gridX}:${gridY}`))).toBe(true);
  });

  test('dense cavern formations include both concentrated clusters and open floor pockets', () => {
    const engine = new TerrainEngine(25, 25);
    const plan = engine.planBiomeGeneration('cavern', { seed: 1, densityMultiplier: 1.65 });
    const regions = Array.from({ length: 25 }, () => ({ floor: 0, formations: 0 }));
    for (let z = 0; z < 25; z++)
      for (let x = 0; x < 25; x++)
        if (plan.heights[z][x] <= -5) regions[Math.floor(z / 5) * 5 + Math.floor(x / 5)].floor++;
    for (const placement of plan.placements)
      if (/^source-cave-(stalagmite|column)$/.test(placement.modelKey || ''))
        regions[Math.floor(placement.gridY / 5) * 5 + Math.floor(placement.gridX / 5)].formations++;
    const openRegions = regions.filter(({ floor }) => floor >= 15);
    expect(openRegions.some(({ formations }) => formations <= 4)).toBe(true);
    expect(openRegions.some(({ formations }) => formations >= 10)).toBe(true);
  });

  test('new clustered formations vary their positions within and across grid cells', () => {
    const engine = new TerrainEngine(25, 25);
    const plan = engine.planBiomeGeneration('cavern', { seed: 42, densityMultiplier: 1.65 });
    const formations = plan.placements.filter(({ modelKey }) =>
      /^source-cave-(stalagmite|column)$/.test(modelKey || '')
    );
    expect(
      formations.some(
        ({ gridOffsetX = 0, gridOffsetY = 0 }) =>
          Math.abs(gridOffsetX) > 0.2 || Math.abs(gridOffsetY) > 0.2
      )
    ).toBe(true);
  });

  test.each(['cavern', 'crystalSpires'])(
    '%s keeps dense formations within the 800-model budget across seeds',
    (biomeKey) => {
      const engine = new TerrainEngine(100, 100);
      for (const seed of [1, 42, 99]) {
        const plan = engine.planBiomeGeneration(biomeKey, { seed, densityMultiplier: 2 });
        const formations = plan.placements.filter(({ modelKey }) =>
          /^source-cave-(stalagmite|column)$/.test(modelKey || '')
        );
        expect(formations.length).toBeGreaterThan(0);
        expect(formations.length).toBeLessThanOrEqual(800);
      }
    }
  );

  test.each([0, 2, 7, 42, 12345])(
    'Cavern seed %i generates actual formations away from its entrance passages',
    (seed) => {
      const engine = new TerrainEngine(25, 25);
      const plan = engine.planBiomeGeneration('cavern', { seed });
      const formations = plan.placements.filter(({ modelKey }) =>
        ['source-cave-stalagmite', 'source-cave-column'].includes(modelKey)
      );
      expect(formations.length).toBeGreaterThan(0);
      const entranceCells = new Set(
        plan.cavern.exits.flatMap((side) =>
          cavernEntranceCells(side, 25, 25).map(({ x, z }) => `${x}:${z}`)
        )
      );
      const passageCells = new Set(
        naturalCavernRoutes({
          cols: 25,
          rows: 25,
          getHeight: (x, z) => plan.heights[z][x],
          exits: plan.cavern.exits,
          seed,
        }).flatMap(({ cells }) => cells.map(({ x, z }) => `${x}:${z}`))
      );
      for (const { gridX, gridY } of formations) {
        expect(entranceCells.has(`${gridX}:${gridY}`)).toBe(false);
        expect(plan.heights[gridY][gridX]).toBeLessThanOrEqual(-5);
      }
      for (const { gridX, gridY } of plan.placements.filter(({ modelKey }) =>
        /^rock-medium-[234]$/.test(modelKey || '')
      ))
        expect(passageCells.has(`${gridX}:${gridY}`)).toBe(false);
    }
  );

  test('Fungal Grove generates glowing clusters and giant caps without blocking cavern entrances', () => {
    const engine = new TerrainEngine(25, 25);
    const plan = engine.planBiomeGeneration('fungalGrove', { seed: 42 });
    const passages = new Set(
      naturalCavernRoutes({
        cols: 25,
        rows: 25,
        getHeight: (x, z) => plan.heights[z][x],
        exits: plan.cavern.exits,
        seed: 42,
      }).flatMap(({ cells }) => cells.map(({ x, z }) => `${x}:${z}`))
    );
    for (const id of ['mushroom-glow', 'mushroom-giant-cap']) {
      const placements = plan.placements.filter(({ placeableId }) => placeableId === id);
      expect(placements.length).toBeGreaterThan(0);
      expect(placements.every(({ modelKey }) => modelKey === id)).toBe(true);
      expect(isAssetAllowedInBiome(id, 'fungalGrove')).toBe(true);
      expect(isAssetAllowedInBiome(id, 'grassland')).toBe(false);
      for (const { gridX, gridY } of placements)
        expect(passages.has(`${gridX}:${gridY}`)).toBe(false);
    }
    expect(engine.planBiomeGeneration('fungalGrove', { seed: 42 }).placements).toEqual(
      plan.placements
    );
  });

  test.each(['cavern', 'fungalGrove', 'crystalSpires'])(
    '%s has supported routes between every entrance without blocking scenery',
    (biomeKey) => {
      for (const size of [12, 25, 50])
        for (const seed of [1, 7, 42]) {
          const engine = new TerrainEngine(size, size);
          const plan = engine.planBiomeGeneration(biomeKey, { seed, densityMultiplier: 1.65 });
          const routes = naturalCavernRoutes({
            cols: size,
            rows: size,
            getHeight: (x, z) => plan.heights[z][x],
            exits: plan.cavern.exits,
            seed,
          });
          const blocked = new Set(
            plan.placements
              .filter(blocksCreatureMovement)
              .map(({ gridX, gridY }) => `${gridX}:${gridY}`)
          );
          expect(routes).toHaveLength(plan.cavern.exits.length);
          for (const { side, cells } of routes) {
            const center = Math.floor(size / 2);
            expect(cells[0]).toEqual(
              {
                north: { x: center, z: 0 },
                east: { x: size - 1, z: center },
                south: { x: center, z: size - 1 },
                west: { x: 0, z: center },
              }[side]
            );
            expect(cells.at(-1)).toEqual({ x: center, z: center });
            expect(
              cells.some(({ x, z }) =>
                ['north', 'south'].includes(side) ? x !== center : z !== center
              )
            ).toBe(true);
            for (const [index, cell] of cells.entries()) {
              expect(plan.heights[cell.z][cell.x]).toBe(-8);
              expect(blocked.has(`${cell.x}:${cell.z}`)).toBe(false);
              if (index)
                expect(
                  Math.abs(cell.x - cells[index - 1].x) + Math.abs(cell.z - cells[index - 1].z)
                ).toBe(1);
            }
          }
        }
    }
  );

  test.each(['cavern', 'fungalGrove', 'crystalSpires'])(
    '%s entrances are reachable through actual supported movement',
    (biomeKey) => {
      for (const seed of [7, 42]) {
        const size = 25;
        const engine = new TerrainEngine(size, size);
        const plan = engine.planBiomeGeneration(biomeKey, { seed, densityMultiplier: 1.65 });
        const geometry = new TerrainGeometry({
          widthFeet: size * 5,
          depthFeet: size * 5,
          getTerrainHeightFeet: (x, z) => plan.heights[Math.floor(z / 5)][Math.floor(x / 5)] * 1.5,
        });
        const blocked = new Set(
          plan.placements
            .filter(blocksCreatureMovement)
            .map(({ gridX, gridY }) => `${gridX},${gridY}`)
        );
        const center = Math.floor(size / 2);
        const range = buildSurfaceRange({
          geometry,
          start: { gridX: center, gridY: center, heightFeet: -12 },
          speedFeet: size * 10,
          isOccupied: (x, z) => blocked.has(`${x},${z}`),
        });
        for (const { cells } of naturalCavernRoutes({
          cols: size,
          rows: size,
          getHeight: (x, z) => plan.heights[z][x],
          exits: plan.cavern.exits,
          seed,
        })) {
          const entrance = cells[0];
          expect(getSurfaceRoute(range, entrance.x, entrance.z)).not.toBeNull();
        }
      }
    }
  );

  test.each([
    [5, 5],
    [5, 30],
    [30, 5],
    [7, 13],
  ])('a %i by %i cavern keeps connected entrance routes', (cols, rows) => {
    const engine = new TerrainEngine(cols, rows);
    for (const seed of [0, 7, 42]) {
      const plan = engine.planBiomeGeneration('cavern', {
        seed,
        densityMultiplier: 1.65,
        cavernExitCount: 4,
      });
      const routes = naturalCavernRoutes({
        cols,
        rows,
        getHeight: (x, z) => plan.heights[z][x],
        exits: plan.cavern.exits,
        seed,
      });
      expect(plan.cavern.exits).toHaveLength(4);
      expect(routes).toHaveLength(plan.cavern.exits.length);
      for (const { cells } of routes) {
        expect(cells.at(-1)).toEqual({ x: Math.floor(cols / 2), z: Math.floor(rows / 2) });
        expect(cells.every(({ x, z }) => plan.heights[z][x] === -8)).toBe(true);
      }
    }
  });

  test.each(ALL_BIOMES.filter((biome) => biome.rarity === 'exotic').map((biome) => biome.key))(
    '%s generates suitable existing models and captures biome/seed metadata',
    (biomeKey) => {
      const placements = generate(biomeKey);
      expect(placements.length).toBeGreaterThan(0);
      for (const item of placements) {
        expect(item.generatedBiome).toBe(true);
        expect(item.modelKey).toBeTruthy();
        expect(item.biomeKey).toBe(biomeKey);
        expect(item.biomeSeed).toBe(12345);
      }
    }
  );

  test('Lava Fields contains rocks and pebbles, never trees or foliage', () => {
    const placements = generate('lavaFields');
    expect(placements.length).toBeGreaterThan(0);
    expect(placements.every((item) => /^(rock|pebble)-/.test(item.placeableId))).toBe(true);
    const profile = BIOME_FLORA_PROFILES.find((entry) => entry.re.test('lavaFields'));
    expect(Object.keys(profile.weights).every((id) => /^(rock|pebble)-/.test(id))).toBe(true);
  });

  test('Crystal Spires uses formations and Eldritch Rift permits fitting dead trees and fungi', () => {
    const crystal = generate('crystalSpires');
    expect(generate('crystalSpires')).toEqual(crystal);
    expect(crystal.length).toBeGreaterThan(0);
    expect(crystal.every((item) => item.modelKey === 'source-cave-stalagmite')).toBe(true);
    const profile = BIOME_FLORA_PROFILES.find((entry) => entry.re.test('eldritchRift'));
    const ids = Object.keys(profile.weights);
    expect(ids.some((id) => id.startsWith('tree-dead-'))).toBe(true);
    expect(ids.some((id) => id.startsWith('mushroom-'))).toBe(true);
  });

  test('ordinary caves and fungal groves never generate trees', () => {
    for (const biome of ['cavern', 'fungalGrove'])
      expect(generate(biome).every((item) => !item.placeableId.startsWith('tree-'))).toBe(true);
  });

  test('rare Crystal Fields remains bare rather than gaining exotic-only population changes', () => {
    expect(generate('crystalFields')).toHaveLength(0);
  });

  test('the solid rift floor permits below-zero assets without populating ordinary water', () => {
    const placements = [];
    const world = createTerrainWorld(12, 12, {
      addPlaceable: (item) => {
        placements.push(item);
        return Promise.resolve();
      },
    });
    try {
      world.engine.load({ heights: Array.from({ length: 12 }, () => Array(12).fill(-2)) });
      const context = floraContext(world.gm);
      autoPopulateBiomeFlora(context, 'eldritchRift', 12345);
      expect(placements.length).toBeGreaterThan(0);
      placements.length = 0;
      autoPopulateBiomeFlora(context, 'grassland', 12345);
      expect(placements).toHaveLength(0);
      autoPopulateBiomeFlora(context, 'bloodMarsh', 12345);
      expect(placements.length).toBeGreaterThan(0);
      placements.length = 0;
      world.engine.load({ heights: Array.from({ length: 12 }, () => Array(12).fill(-4)) });
      autoPopulateBiomeFlora(context, 'bloodMarsh', 12345);
      expect(placements).toHaveLength(0);
    } finally {
      world.dispose();
    }
  });
});
