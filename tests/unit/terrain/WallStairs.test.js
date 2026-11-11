import { createStructure, structureVolumes } from '../../../src/terrain/ConstructionBlueprints.js';
import { wallStairLayout } from '../../../src/terrain/WallStairs.js';
import { TerrainEngine } from '../../../src/terrain/TerrainEngine.js';
import { buildSurfaceRange, getSurfaceRoute } from '../../../src/terrain/SurfaceNavigation.js';

function wall(changes = {}) {
  return createStructure({
    id: 'wall',
    kind: 'wall',
    style: 'battlement',
    wallStairs: true,
    xFeet: 80,
    zFeet: 80,
    heightFeet: 10,
    lengthFeet: 80,
    widthFeet: 15,
    ...changes,
  });
}

test.each([0.5, 1.5, 3, 4.5])(
  'a short terrace stair rising %s feet retains supported steps and survives reopening',
  (heightFeet) => {
    const spec = wall({ heightFeet, lengthFeet: 30, wallStairExit: 'terrace' }),
      layout = wallStairLayout(spec),
      engine = new TerrainEngine(35, 30);
    expect(createStructure({ ...spec, source: 'generated' }).heightFeet).toBe(heightFeet);
    engine.placeStructure(spec);
    let previous = 0;
    for (const point of layout.path) {
      expect(point.y - previous).toBeLessThanOrEqual(1.25 + 1e-6);
      previous = point.y;
      expect(
        engine.geometry.findSupport(spec.xFeet + point.x, spec.zFeet + point.z, {
          belowFeet: point.y + 1e-6,
          clearanceFeet: 5,
        })?.heightFeet
      ).toBeCloseTo(point.y);
    }
    expect(layout.exit.y).toBe(heightFeet);
    const saved = engine.save(),
      restored = new TerrainEngine(35, 30);
    restored.load(saved);
    expect(restored.save()).toEqual(saved);
  }
);

test('short terrace stair validation retains ordinary wall minima and rejects invalid rises', () => {
  expect(() => wall({ heightFeet: 3, wallStairs: false })).toThrow(/dimensions/i);
  expect(() => wall({ heightFeet: 0 })).toThrow(/dimensions/i);
  expect(() => wall({ heightFeet: 0.25 })).toThrow(/dimensions/i);
  expect(() => wall({ heightFeet: 101 })).toThrow(/dimensions/i);
});

test.each([20, 30, 60])(
  'new %i-foot switchbacks ascend toward the wall on solid masonry rather than floating over lower flights',
  (heightFeet) => {
    const spec = wall({ heightFeet, lengthFeet: 70 }),
      layout = wallStairLayout(spec);
    const treads = layout.steps.filter((step) => /^stair-\d+$/.test(step.id));
    expect(treads.every((step) => step.bounds.min.y === 0)).toBe(true);
    const low = treads[0],
      high = treads.at(-1),
      edge = -spec.widthFeet / 2;
    expect(Math.abs((high.bounds.min.z + high.bounds.max.z) / 2 - edge)).toBeLessThan(
      Math.abs((low.bounds.min.z + low.bounds.max.z) / 2 - edge)
    );
    expect(high.bounds.max.z).toBe(edge);
    expect(layout.widthFeet).toBe(Math.ceil(heightFeet / 10) * 7.5);
  }
);

test('wall stairs reverse ascent, change sides and move along the wall without rotating the wall', () => {
  const normal = wall(),
    layout = wallStairLayout(normal);
  const flipped = wall({
    wallStairDirection: 'reverse',
    wallStairSide: 'far',
    wallStairOffsetFeet: 20,
  });

  const next = wallStairLayout(flipped);
  expect(flipped.angleRadians).toBe(0);
  expect(next.mode).toBe('straight');
  expect(next.entry.x).toBeGreaterThan(next.exit.x);
  expect(layout.entry.x).toBeLessThan(layout.exit.x);
  expect(next.entry.z).toBeGreaterThan(flipped.widthFeet / 2);
  expect(layout.entry.z).toBeLessThan(-normal.widthFeet / 2);
  const volumes = structureVolumes(flipped).filter((v) => /^wall-stair-\d+$/.test(v.id));
  expect(volumes).toHaveLength(8);
  expect(volumes.every((v) => v.bounds.min.z === 87.5)).toBe(true);
});

test.each([15, 20, 30, 60])(
  'a new %i-foot battlement uses bounded switchbacks with real supported steps and safe headroom',
  (heightFeet) => {
    const spec = wall({ heightFeet, lengthFeet: 60 });
    const layout = wallStairLayout(spec);
    expect(layout.mode).toBe('switchback');
    expect(layout.lengthFeet).toBe(55);
    expect(layout.widthFeet).toBe(Math.ceil(heightFeet / 10) * 7.5);
    expect(layout.path.at(-1).y).toBe(heightFeet);
    expect(layout.steps.length).toBeLessThanOrEqual(100);
    const engine = new TerrainEngine(35, 30);
    engine.placeStructure(spec);
    let previous = 0;
    for (const point of layout.path) {
      expect(point.y - previous).toBeLessThanOrEqual(1.25 + 1e-6);
      previous = point.y;
      expect(
        engine.geometry.findSupport(spec.xFeet + point.x, spec.zFeet + point.z, {
          belowFeet: point.y + 1e-6,
          clearanceFeet: 5,
        })?.heightFeet
      ).toBeCloseTo(point.y);
    }
    const transformed = (p) => ({ x: spec.xFeet + p.x, z: spec.zFeet + p.z });
    const entry = transformed(layout.entry),
      exit = transformed(layout.exit);
    const range = buildSurfaceRange({
      geometry: engine.geometry,
      start: {
        gridX: Math.floor(entry.x / 5),
        gridY: Math.floor(entry.z / 5),
        xFeet: entry.x,
        zFeet: entry.z,
        heightFeet: 0,
      },
      speedFeet: 500,
    });
    expect(
      getSurfaceRoute(range, Math.floor(exit.x / 5), Math.floor(exit.z / 5), { heightFeet })
    ).not.toBeNull();
  }
);

test('invalid stair settings and offsets outside the actual wall are explicit errors', () => {
  expect(() => wall({ wallStairSide: 'invalid' })).toThrow(/stair/i);
  expect(() => wall({ wallStairDirection: 'invalid' })).toThrow(/stair/i);
  expect(() => wall({ wallStairOffsetFeet: -1 })).toThrow(/stair/i);
  expect(() => wall({ wallStairOffsetFeet: 60 })).toThrow(/stair/i);
  expect(() => wall({ wallStairLayout: 'switchback', heightFeet: 10 })).toThrow(/straight/i);
});

test('saved pre-layout tall walls retain their original straight stairs until explicitly edited', () => {
  const spec = createStructure(
    {
      id: 'old',
      kind: 'wall',
      style: 'battlement',
      wallStairs: true,
      xFeet: 160,
      zFeet: 80,
      heightFeet: 60,
      lengthFeet: 245,
      widthFeet: 15,
    },
    { legacy: true }
  );
  expect(spec.wallStairLayout).toBeUndefined();
  expect(wallStairLayout(spec).mode).toBe('straight');
  expect(structureVolumes(spec).filter((v) => /^old-stair-\d+$/.test(v.id))).toHaveLength(48);
  const engine = new TerrainEngine(65, 30);
  engine.load({
    ...engine.save(),
    geometry: { version: 3, structures: [spec], volumes: structureVolumes(spec) },
  });
  expect(engine.geometry.getStructures()[0].wallStairLayout).toBeUndefined();
  expect(engine.geometry.save().volumes.filter((v) => /^old-stair-\d+$/.test(v.id))).toHaveLength(
    48
  );
  const saved = engine.save(),
    restored = new TerrainEngine(65, 30);
  restored.load(saved);
  expect(restored.save()).toEqual(saved);
});

test.each([
  ['near', 'reverse', 0],
  ['far', 'forward', 0],
  ['far', 'reverse', Math.PI / 2],
  ['near', 'forward', Math.PI / 4],
])(
  'switchback stairs remain walkable on %s side with %s ascent at rotation %s',
  (side, direction, angle) => {
    const spec = wall({
      heightFeet: 20,
      lengthFeet: 70,
      wallStairSide: side,
      wallStairDirection: direction,
      wallStairOffsetFeet: 10,
      angleRadians: angle,
    });
    const layout = wallStairLayout(spec),
      engine = new TerrainEngine(35, 35);
    engine.placeStructure(spec);
    const transform = (p) => ({
      x: spec.xFeet + p.x * Math.cos(angle) - p.z * Math.sin(angle),
      z: spec.zFeet + p.x * Math.sin(angle) + p.z * Math.cos(angle),
    });
    const entry = transform(layout.entry),
      exit = transform(layout.exit);
    const range = buildSurfaceRange({
      geometry: engine.geometry,
      start: {
        gridX: Math.floor(entry.x / 5),
        gridY: Math.floor(entry.z / 5),
        xFeet: entry.x,
        zFeet: entry.z,
        heightFeet: 0,
      },
      speedFeet: 500,
    });
    expect(
      Math.max(...[...range.tiles.values()].map((cell) => cell.heightFeet))
    ).toBeGreaterThanOrEqual(20);
    expect(
      getSurfaceRoute(range, Math.floor(exit.x / 5), Math.floor(exit.z / 5), { heightFeet: 20 })
    ).not.toBeNull();
  }
);
