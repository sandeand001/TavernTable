import { TerrainEngine } from '../../../src/terrain/TerrainEngine.js';
import { createStructure, structureVolumes } from '../../../src/terrain/ConstructionBlueprints.js';
import { stretchStructureHeight } from '../../../src/terrain/ConstructionHandles.js';
import { normalizeVolumeShape } from '../../../src/terrain/TerrainVolumeShape.js';

test('stalagmites have organic solid stems, fused growths and no room or artificial floor', () => {
  const spec = createStructure({
    id: 'rock',
    kind: 'stalagmite',
    xFeet: 50,
    zFeet: 50,
    diameterFeet: 20,
    heightFeet: 30,
  });
  const volumes = structureVolumes(spec);
  expect(volumes.length).toBeGreaterThan(9);
  expect(
    volumes.every((volume) => volume.operation === 'add' && volume.shape.kind === 'polyhedron')
  ).toBe(true);
  expect(volumes.every((volume) => volume.materialRole === 'rock')).toBe(true);
  expect(volumes.every((volume) => volume.materialStyle === 'rock')).toBe(true);
  const main = volumes.filter((volume) => /^rock-rock-\d+$/.test(volume.id));
  const tip = main.at(-1).bounds;
  const engine = new TerrainEngine(25, 25);
  engine.placeStructure(spec);
  expect(
    engine.geometry.findSupport((tip.min.x + tip.max.x) / 2, (tip.min.z + tip.max.z) / 2, {
      belowFeet: 40,
    }).heightFeet
  ).toBeCloseTo(30);
  expect(engine.geometry.findSupport(59, 50, { belowFeet: 40 }).heightFeet).toBeLessThan(20);
  expect(
    engine.geometry.isSpaceClear({
      min: { x: 58, y: 1, z: 58 },
      max: { x: 59, y: 5, z: 59 },
    })
  ).toBe(true);
  const saved = engine.save(),
    restored = new TerrainEngine(25, 25);
  restored.load(saved);
  expect(restored.save()).toEqual(saved);
});

test('organic profiles have asymmetric feet, stand vertically and taper into narrow stone points', () => {
  const spec = createStructure({
    id: 'organic-contour',
    kind: 'stalagmite',
    xFeet: 50,
    zFeet: 50,
    diameterFeet: 20,
    heightFeet: 30,
  });
  const volumes = structureVolumes(spec);
  const main = volumes.filter((volume) => /^organic-contour-rock-\d+$/.test(volume.id));
  const ring = (volume, top) => {
    const vertices = volume.shape.vertices;
    return vertices.slice(top ? vertices.length / 2 : 0, top ? undefined : vertices.length / 2);
  };
  const width = (points) =>
    Math.max(...points.map((p) => p.x)) - Math.min(...points.map((p) => p.x));
  const foot = ring(main[0], false),
    middle = ring(main[4], true),
    tip = ring(main.at(-1), true);
  expect(main).toHaveLength(9);
  expect(width(middle)).toBeLessThan(width(foot) * 0.6);
  expect(width(tip)).toBeGreaterThan(width(foot) * 0.015);
  expect(width(tip)).toBeLessThan(width(foot) * 0.03);
  const radii = foot.map((p) => Math.hypot(p.x - spec.xFeet, p.z - spec.zFeet));
  expect(Math.max(...radii) / Math.min(...radii)).toBeGreaterThan(1.1);
  expect(Math.max(...tip.map((p) => p.x)) + Math.min(...tip.map((p) => p.x))).toBeCloseTo(
    spec.xFeet * 2
  );
  expect(volumes.some((volume) => volume.id.includes('-growth-'))).toBe(true);
});

test.each(['stalagmite', 'stalactite'])(
  '%s stems stay vertical with a straight taper and no pedestal, pinched waist or bulbous head',
  (kind) => {
    for (let i = 0; i < 40; i++) {
      const volumes = structureVolumes(
        createStructure({
          id: `taper-${i}`,
          kind,
          xFeet: 50,
          zFeet: 50,
          diameterFeet: 20,
          heightFeet: 30,
        })
      );
      const stems = new Map();
      for (const volume of volumes) {
        const stemId = volume.id.replace(/-rock-\d+$/, '');
        if (!stems.has(stemId)) stems.set(stemId, []);
        stems.get(stemId).push(volume);
      }
      for (const stem of stems.values()) {
        const ringWidth = (vertices) =>
          Math.max(...vertices.map((p) => p.x)) - Math.min(...vertices.map((p) => p.x));
        const half = stem[0].shape.vertices.length / 2;
        const rings = [
          stem[0].shape.vertices.slice(0, half),
          ...stem.map((volume) => volume.shape.vertices.slice(half)),
        ];
        if (kind === 'stalactite') rings.reverse();
        const widths = rings.map(ringWidth);
        const footY = rings[0][0].y,
          tipY = rings.at(-1)[0].y;
        for (const [j, ring] of rings.entries()) {
          for (const axis of ['x', 'z']) {
            const center = (points) =>
              (Math.min(...points.map((p) => p[axis])) + Math.max(...points.map((p) => p[axis]))) /
              2;
            expect(center(ring)).toBeCloseTo(center(rings[0]), 10);
          }
          const along = (ring[0].y - footY) / (tipY - footY);
          expect(widths[j]).toBeCloseTo(widths[0] + (widths.at(-1) - widths[0]) * along, 10);
        }
        for (let j = 1; j < widths.length; j++) expect(widths[j]).toBeLessThan(widths[j - 1]);
        if (!stem[0].id.includes('-growth-')) expect(widths[1]).toBeGreaterThan(widths[0] * 0.88);
        expect(widths.at(-1)).toBeLessThan(widths[0] * 0.04);
      }
    }
  }
);

test.each([
  ['stalagmite', 5, 20],
  ['stalactite', 3, 10],
])(
  '%s defaults are slender and allow one-foot diameters without lowering building limits',
  (kind, diameterFeet, heightFeet) => {
    const spec = createStructure({ id: 'slender', kind, xFeet: 50, zFeet: 50 });
    expect(spec.diameterFeet).toBe(diameterFeet);
    expect(spec.heightFeet).toBe(heightFeet);
    expect(spec.diameterFeet / spec.heightFeet).toBeLessThanOrEqual(0.3);
    const engine = new TerrainEngine(25, 25);
    engine.placeStructure({ ...spec, diameterFeet: 1 });
    expect(engine.geometry.getStructures()[0].diameterFeet).toBe(1);
    const saved = engine.save(),
      restored = new TerrainEngine(25, 25);
    restored.load(saved);
    expect(restored.save()).toEqual(saved);
    expect(() => createStructure({ ...spec, diameterFeet: 0.5 })).toThrow(/dimensions/);
    expect(() =>
      createStructure({ ...spec, kind: 'dome', rockProfileVersion: undefined, diameterFeet: 14 })
    ).toThrow(/dimensions/);
  }
);

test.each(['stalagmite', 'stalactite'])(
  '%s profiles vary reproducibly and remain convex, closed and within their diameter',
  (kind) => {
    const profiles = new Set();
    for (let i = 0; i < 40; i++) {
      const spec = createStructure({
        id: `formation-${i}`,
        kind,
        xFeet: 50,
        zFeet: 50,
        diameterFeet: 20,
        heightFeet: 30,
        baseFeet: -12,
      });
      const volumes = structureVolumes(spec);
      expect(structureVolumes(spec)).toEqual(volumes);
      profiles.add(JSON.stringify(volumes.map((volume) => volume.shape.vertices)));
      for (const volume of volumes) {
        expect(normalizeVolumeShape(volume.shape, volume.bounds)).toEqual(volume.shape);
        expect(volume.bounds.min.x).toBeGreaterThanOrEqual(40);
        expect(volume.bounds.max.x).toBeLessThanOrEqual(60);
        expect(volume.bounds.min.z).toBeGreaterThanOrEqual(40);
        expect(volume.bounds.max.z).toBeLessThanOrEqual(60);
        expect(volume.bounds.min.y).toBeGreaterThanOrEqual(-12);
        expect(volume.bounds.max.y).toBeLessThanOrEqual(18);
      }
    }
    expect(profiles.size).toBe(40);
  }
);

test('legacy uniform rocks keep their saved geometry and new rocks record an organic profile', () => {
  const legacy = createStructure(
    { id: 'old-rock', kind: 'stalagmite', xFeet: 50, zFeet: 50 },
    { legacy: true }
  );
  expect(legacy.rockProfileVersion).toBeUndefined();
  expect(structureVolumes(legacy)).toHaveLength(3);
  expect(structureVolumes(legacy).every((volume) => volume.materialStyle === 'none')).toBe(true);
  const engine = new TerrainEngine(25, 25);
  engine.placeStructure(legacy);
  const saved = engine.save(),
    restored = new TerrainEngine(25, 25);
  restored.load(saved);
  expect(restored.save()).toEqual(saved);
  expect(
    createStructure({ id: 'new-rock', kind: 'stalagmite', xFeet: 50, zFeet: 50 }).rockProfileVersion
  ).toBe(2);
  for (const rockProfileVersion of [0, 3, null, '2', NaN])
    expect(() => createStructure({ ...legacy, rockProfileVersion })).toThrow(/profile/);
  expect(() => createStructure({ ...legacy, kind: 'wall', rockProfileVersion: 2 })).toThrow(
    /profile/
  );
});

test('stalactites taper downward and changing height keeps the ceiling anchor fixed', () => {
  const spec = createStructure({
    id: 'hanging',
    kind: 'stalactite',
    xFeet: 50,
    zFeet: 50,
    baseFeet: 10,
    heightFeet: 20,
    diameterFeet: 20,
  });
  const next = stretchStructureHeight(spec, -5);
  expect(next.heightFeet).toBe(25);
  expect(next.baseFeet + next.heightFeet).toBe(30);
  const engine = new TerrainEngine(25, 25);
  engine.placeStructure(spec);
  engine.resizeStructure(spec.id, { heightFeet: 15 });
  const changed = engine.geometry.getStructures()[0];
  expect(changed.baseFeet).toBe(15);
  expect(changed.baseFeet + changed.heightFeet).toBe(30);
  engine.undo();
  expect(engine.geometry.getStructures()[0]).toEqual(spec);
});
