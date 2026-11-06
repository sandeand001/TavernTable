import { TerrainEngine } from '../../../src/terrain/TerrainEngine.js';
import { createStructure, structureVolumes } from '../../../src/terrain/ConstructionBlueprints.js';

const wall = (changes = {}) =>
  createStructure({
    id: 'built-wall',
    kind: 'wall',
    xFeet: 50,
    zFeet: 50,
    lengthFeet: 40,
    heightFeet: 10,
    angleRadians: Math.PI / 4,
    ...changes,
  });

test.each([
  [0, 0, 1],
  [Math.PI / 2, -1, 0],
  [Math.PI, 0, -1],
  [-Math.PI / 2, 1, 0],
])(
  'cardinal gate rotation %s keeps clear, supported passage at both exact wall faces',
  (angle, xDirection, zDirection) => {
    const engine = new TerrainEngine(20, 20);
    engine.placeStructure(
      wall({
        style: 'battlement',
        lengthFeet: 60,
        widthFeet: 10,
        heightFeet: 15,
        opening: true,
        angleRadians: angle,
      })
    );
    for (const sign of [-1, 1]) {
      const x = 50 + xDirection * sign * 5,
        z = 50 + zDirection * sign * 5;
      expect(
        engine.geometry.isSpaceClear({
          min: { x: x - 2.49, y: 1e-4, z: z - 2.49 },
          max: { x: x + 2.49, y: 6, z: z + 2.49 },
        })
      ).toBe(true);
      expect(
        engine.geometry.findSupport(x, z, { belowFeet: 1e-4, clearanceFeet: 6 })?.heightFeet
      ).toBe(0);
    }
  }
);

test('arbitrary-angle plain and battlement walls share real geometry rather than a solid bounding box', () => {
  for (const style of ['plain', 'battlement']) {
    const engine = new TerrainEngine(25, 25);
    engine.placeStructure(wall({ style }));
    expect(
      engine.geometry.isSpaceClear({
        min: { x: 48, y: 1, z: 48 },
        max: { x: 52, y: 5, z: 52 },
      })
    ).toBe(false);
    expect(
      engine.geometry.isSpaceClear({
        min: { x: 36, y: 1, z: 62 },
        max: { x: 38, y: 5, z: 64 },
      })
    ).toBe(true);
    expect(engine.geometry.findSupport(50, 50, { belowFeet: 20 })?.heightFeet).toBe(10);
    expect(engine.geometry.getStructures()).toEqual([wall({ style })]);
  }
});

test('diameter and height edits regenerate the complete structure, keep its IDs and undo as one action', () => {
  const engine = new TerrainEngine(25, 25);
  const dome = createStructure({
    id: 'dome',
    kind: 'dome',
    xFeet: 50,
    zFeet: 50,
    diameterFeet: 30,
  });
  engine.placeStructure(dome);
  const original = engine.save();
  engine.resizeStructure('dome', { diameterFeet: 40, heightFeet: 20 });
  expect(engine.geometry.getStructures()[0]).toMatchObject({ diameterFeet: 40, heightFeet: 20 });
  expect(engine.geometry.getSurfacesAt(50, 50)[0].ceilingFeet).toBe(18);
  const changed = engine.save();
  engine.undo();
  expect(engine.save()).toEqual(original);
  engine.redo();
  expect(engine.save()).toEqual(changed);
  const reopened = new TerrainEngine(1, 1);
  reopened.load(changed);
  expect(reopened.save()).toEqual(changed);
  expect(reopened.geometry.structureAt({ x: 50, y: 20, z: 50 })?.id).toBe('dome');
});

test('wall height can change after placement without moving its footprint or losing plain-wall style', () => {
  const engine = new TerrainEngine(25, 25);
  engine.placeStructure(wall());
  engine.resizeStructure('built-wall', { heightFeet: 20 });
  expect(engine.geometry.getStructures()[0]).toMatchObject({
    style: 'plain',
    xFeet: 50,
    zFeet: 50,
    lengthFeet: 40,
    heightFeet: 20,
  });
  expect(engine.geometry.findSupport(50, 50, { belowFeet: 30 })?.heightFeet).toBe(20);
});

test('invalid resizes and protected geometry edits are rejected without changing history or saved data', () => {
  const engine = new TerrainEngine(25, 25);
  engine.placeStructure(wall());
  const before = engine.save();
  expect(() => engine.resizeStructure('built-wall', { heightFeet: -1 })).toThrow();
  expect(() => engine.resizeStructure('built-wall', { lengthFeet: 1000 })).toThrow();
  const removeGuard = engine.validateGeometryEdits(() => {
    throw new Error('A creature would lose its floor');
  });
  expect(() => engine.resizeStructure('built-wall', { heightFeet: 20 })).toThrow(/creature/);
  expect(engine.save()).toEqual(before);
  removeGuard();
  engine.undo();
  expect(engine.geometry.hasVolumes).toBe(false);
});

test('removing a complete structure leaves unrelated legacy volumes and can be undone', () => {
  const engine = new TerrainEngine(25, 25);
  engine.addVolume({
    id: 'legacy',
    bounds: { min: { x: 5, y: 0, z: 5 }, max: { x: 10, y: 5, z: 10 } },
  });
  engine.placeStructure(wall());
  const saved = engine.save();
  engine.removeStructure('built-wall');
  expect(engine.geometry.getStructures()).toEqual([]);
  expect(engine.geometry.save().volumes.map((v) => v.id)).toEqual(['legacy']);
  engine.undo();
  expect(engine.save()).toEqual(saved);
});

test.each(['dome', 'turret', 'cave', 'tunnel', 'building'])(
  '%s blueprints are bounded independent data with a usable opening and deterministic IDs',
  (kind) => {
    const spec = createStructure({ id: kind, kind, xFeet: 50, zFeet: 50 });
    const volumes = structureVolumes(spec);
    expect(volumes).toEqual(structureVolumes(spec));
    expect(volumes.some((v) => v.operation === 'subtract')).toBe(true);
    expect(volumes.every((v) => v.structureId === kind)).toBe(true);
    const engine = new TerrainEngine(25, 25);
    engine.placeStructure(spec);
    expect(engine.geometry.findSupport(50, 50, { belowFeet: 0, clearanceFeet: 5 })).not.toBeNull();
  }
);

test('raised hollow structures have their own physical floor and curved metadata survives board cropping', () => {
  const engine = new TerrainEngine(25, 25);
  engine.placeStructure({ id: 'raised', kind: 'dome', xFeet: 50, zFeet: 50, baseFeet: 10 });
  expect(engine.geometry.findSupport(50, 50, { belowFeet: 10, clearanceFeet: 5 })?.heightFeet).toBe(
    10
  );
  engine.resize(11, 25);
  expect(engine.geometry.getStructures()[0]).toMatchObject({ id: 'raised', diameterFeet: 30 });
  const restored = new TerrainEngine(1, 1);
  restored.load(engine.save());
  expect(restored.geometry.getStructures()).toEqual(engine.geometry.getStructures());
});
