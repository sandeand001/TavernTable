import * as three from 'three';
import TargetingOverlay from '../../../../src/scene/targeting/TargetingOverlay.js';
import { validateTargetingProfile } from '../../../../src/rules/targeting/profiles.js';
import { inArea } from '../../../../src/rules/targeting/geometry.js';

test('a selected melee mode draws only its own range, not the thrown maximum', () => {
  const scene = new three.Scene(),
    overlay = new TargetingOverlay(three, scene);
  const actor = {
    id: 'a',
    world: { x: 0, y: 0, z: 0 },
    allegiance: 'friendly',
    conditions: [],
    abilities: {},
  };
  const board = { tileSize: 1, tokens: [actor], clearPath: () => true };
  const profile = validateTargetingProfile({
    version: 1,
    kind: 'tokens',
    rangeFeet: 60,
    attack: true,
    modes: [
      { id: 'melee', normal: 5, long: 5 },
      { id: 'thrown', normal: 20, long: 60 },
    ],
  });
  overlay.update(board, actor, profile, { mode: 'melee', targets: [] }, []);
  const ranges = overlay.group.children.filter((node) => node.isLineLoop);
  expect(ranges).toHaveLength(1);
  expect(Math.max(...ranges[0].geometry.attributes.position.array)).toBe(1);
  overlay.dispose();
  expect(scene.children).toEqual([]);
});

test.each([
  { x: 1, y: 0, z: 0 },
  { x: 0, y: 0, z: -1 },
  { x: 1 / Math.sqrt(3), y: 1 / Math.sqrt(3), z: 1 / Math.sqrt(3) },
])(
  'line targeting includes exactly the same rotated cross-section shown by the mesh: %j',
  (direction) => {
    const overlay = new TargetingOverlay(three, new three.Scene());
    const area = {
      shape: 'line',
      origin: { x: 2, y: 1, z: 2 },
      direction,
      size: 10,
      width: 1,
      height: 1,
    };
    overlay.area(area, 0x00ff00, 0.2);
    const mesh = overlay.group.children[0];
    mesh.updateMatrixWorld(true);
    const inside = mesh.localToWorld(new three.Vector3(0.45, 0.45, 0));
    const outside = mesh.localToWorld(new three.Vector3(0.51, 0, 0));
    expect(inArea(inside, area)).toBe(true);
    expect(inArea(outside, area)).toBe(false);
    overlay.dispose();
  }
);

test('following areas move with their caster while fixed areas keep their original origin', () => {
  const overlay = new TargetingOverlay(three, new three.Scene());
  const area = {
    shape: 'sphere',
    origin: { x: 1, y: 0, z: 1 },
    direction: { x: 1, y: 0, z: 0 },
    size: 3,
    width: 1,
    height: 1,
  };
  const effects = [
    { area, sourceId: 'spell:fog-cloud', followCaster: false },
    { area, sourceId: 'spell:spirit-guardians', followCaster: true, casterTokenId: 'caster' },
  ];
  overlay.update(
    { tokens: [{ id: 'caster', world: { x: 6, y: 2, z: 5 } }] },
    null,
    null,
    null,
    effects
  );
  expect(overlay.group.children.map((mesh) => mesh.position.toArray())).toEqual([
    [1, 0, 1],
    [6, 2, 5],
  ]);
  overlay.dispose();
});

test('persistent flight rings stay behind creature visuals, follow recipients and clean up', () => {
  const scene = new three.Scene(),
    overlay = new TargetingOverlay(three, scene);
  const board = {
    tileSize: 2,
    tokens: [
      { id: 'flyer', world: { x: 1, y: 3, z: 2 } },
      { id: 'second', world: { x: 4, y: 1, z: 5 } },
      { id: 'unaffected', world: { x: 6, y: 0, z: 7 } },
    ],
  };
  const effects = [{ kind: 'flight', targetTokenIds: ['flyer', 'second'] }];
  const rings = () =>
    overlay.group
      .getObjectsByProperty('isMesh', true)
      .filter((mesh) => mesh.geometry.type === 'RingGeometry');
  overlay.update(board, null, null, null, effects);
  expect(rings()).toHaveLength(2);
  for (const ring of rings()) {
    expect(ring.material.depthTest).toBe(true);
    expect(ring.material.depthWrite).toBe(false);
    expect(ring.material.transparent).toBe(true);
    expect(ring.parent.isGroup).toBe(true);
    expect(ring.parent.renderOrder).toBeLessThan(0);
    expect(ring.geometry.parameters.outerRadius).toBeCloseTo(board.tileSize * 0.52);
    expect(ring.geometry.parameters.outerRadius).toBeGreaterThan(board.tileSize * 0.46);
    expect(ring.material.color.getHex()).toBe(0x67e8f9);
    const intersections = [];
    ring.raycast(new three.Raycaster(), intersections);
    expect(intersections).toEqual([]);
  }
  expect(rings().map((ring) => ring.position.toArray())).toEqual([
    [1, 3.025, 2],
    [4, 1.025, 5],
  ]);
  const original = rings()[0];
  const disposeGeometry = jest.spyOn(original.geometry, 'dispose');
  const disposeMaterial = jest.spyOn(original.material, 'dispose');
  board.tokens[0].world = { x: 2, y: 6, z: 3 };
  overlay.update(board, null, null, null, effects);
  expect(rings()[0].position.toArray()).toEqual([2, 6.025, 3]);
  expect(disposeGeometry).toHaveBeenCalledTimes(1);
  expect(disposeMaterial).toHaveBeenCalledTimes(1);
  overlay.update(board, null, null, null, []);
  expect(overlay.group.children).toEqual([]);
  overlay.dispose();
  expect(scene.children).toEqual([]);
});

test('target-selection previews keep their foreground rings alongside persistent flight', () => {
  const overlay = new TargetingOverlay(three, new three.Scene());
  const actor = {
    id: 'caster',
    world: { x: 0, y: 0, z: 0 },
    allegiance: 'friendly',
    conditions: [],
    abilities: {},
  };
  const board = { tileSize: 1, tokens: [actor], clearPath: () => true };
  const profile = validateTargetingProfile({
    version: 1,
    kind: 'tokens',
    rangeFeet: 5,
    attack: true,
    modes: [{ id: 'melee', normal: 5, long: 5 }],
  });
  overlay.update(board, actor, profile, { mode: 'melee', targets: [] }, [
    { kind: 'flight', targetTokenIds: [actor.id] },
  ]);
  const previewRings = overlay.group.children.filter(
    (node) => node.isMesh && node.geometry.parameters.outerRadius === 0.36
  );
  expect(previewRings).toHaveLength(1);
  expect(previewRings[0].material.depthTest).toBe(false);
  expect(previewRings[0].parent).toBe(overlay.group);
  expect(previewRings[0].geometry.parameters.outerRadius).toBeCloseTo(0.36);
  expect(overlay.group.renderOrder).toBe(6);
  expect(overlay.group.children.filter((node) => node.isLineLoop)).toHaveLength(1);
  overlay.dispose();
});

test('flight indicators follow ground projections without lifting targeting previews out of the air', () => {
  const overlay = new TargetingOverlay(three, new three.Scene());
  const actor = {
    id: 'flyer',
    world: { x: 2, y: 8, z: 3 },
    groundWorld: { x: 2, y: 1, z: 3 },
    allegiance: 'friendly',
    conditions: [],
    abilities: {},
  };
  const board = { tileSize: 2, tokens: [actor], clearPath: () => true };
  const effects = [{ kind: 'flight', targetTokenIds: [actor.id] }];
  const profile = validateTargetingProfile({
    version: 1,
    kind: 'tokens',
    rangeFeet: 5,
    attack: true,
    modes: [{ id: 'melee', normal: 5, long: 5 }],
  });
  const flightRing = () =>
    overlay.group.getObjectByName('FlightEffectIndicators').getObjectsByProperty('isMesh', true)[0];
  overlay.update(board, actor, profile, { mode: 'melee', targets: [] }, effects);
  expect(flightRing().position.toArray()).toEqual([2, 1.03, 3]);
  expect(overlay.group.children.find((node) => node.isMesh).position.y).toBeCloseTo(8.025);
  expect(
    overlay.group.children.find((node) => node.isLineLoop).geometry.attributes.position.getY(0)
  ).toBeCloseTo(8.025);
  actor.world.y = 12;
  overlay.update(board, null, null, null, effects);
  expect(flightRing().position.toArray()).toEqual([2, 1.03, 3]);
  actor.world.x = 4;
  actor.groundWorld = { x: 4, y: 2, z: 3 };
  overlay.update(board, null, null, null, effects);
  expect(flightRing().position.toArray()).toEqual([4, 2.03, 3]);
  expect(actor.world.y).toBe(12);
  overlay.dispose();
});
