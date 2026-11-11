import * as three from 'three';
import TargetingOverlay from '../../../../src/scene/targeting/TargetingOverlay.js';
import { inArea, areaPlacement } from '../../../../src/rules/targeting/geometry.js';
import { validateTargetingProfile } from '../../../../src/rules/targeting/profiles.js';
import { validateTargetSelection } from '../../../../src/rules/targeting/assessment.js';

test.each([
  { x: 1, y: 0, z: 0 },
  { x: 0, y: 0, z: -1 },
  { x: 0.6, y: 0, z: 0.8 },
])('wall inclusion matches the rendered length, height and thickness: %j', (direction) => {
  const overlay = new TargetingOverlay(three, new three.Scene());
  const area = {
    shape: 'wall',
    origin: { x: 2, y: 1, z: 3 },
    direction,
    size: 10,
    width: 0.5,
    height: 6,
  };
  overlay.area(area, 0x00ff00, 0.2);
  const mesh = overlay.group.children[0];
  mesh.updateMatrixWorld(true);
  expect(inArea(mesh.localToWorld(new three.Vector3(0.24, 2.9, 4.9)), area)).toBe(true);
  expect(inArea(mesh.localToWorld(new three.Vector3(0.26, 0, 0)), area)).toBe(false);
  expect(inArea(mesh.localToWorld(new three.Vector3(0, 3.1, 0)), area)).toBe(false);
  expect(inArea(mesh.localToWorld(new three.Vector3(0, 0, -5.1)), area)).toBe(false);
  overlay.dispose();
});

test('a ring wall renders an actual hole and does not include creatures inside its center', () => {
  const overlay = new TargetingOverlay(three, new three.Scene());
  const area = {
    shape: 'ring',
    origin: { x: 2, y: 1, z: 3 },
    direction: { x: 1, y: 0, z: 0 },
    size: 10,
    width: 1,
    height: 20,
  };
  overlay.area(area, 0xff0000, 0.2);
  const geometry = overlay.group.children[0].geometry;
  expect(geometry.type).toBe('ExtrudeGeometry');
  expect(geometry.parameters.shapes.holes).toHaveLength(1);
  expect(inArea({ x: 11.5, y: 10, z: 3 }, area)).toBe(true);
  expect(inArea({ x: 2, y: 10, z: 3 }, area)).toBe(false);
  expect(inArea({ x: 10.9, y: 10, z: 3 }, area)).toBe(false);
  expect(inArea({ x: 12.1, y: 10, z: 3 }, area)).toBe(false);
  expect(inArea({ x: 11.5, y: 21.1, z: 3 }, area)).toBe(false);
  overlay.dispose();
});

test('a dome includes only the hemisphere above its origin', () => {
  const overlay = new TargetingOverlay(three, new three.Scene());
  const area = {
    shape: 'hemisphere',
    origin: { x: 2, y: 1, z: 3 },
    direction: { x: 1, y: 0, z: 0 },
    size: 10,
    width: 1,
    height: 10,
  };
  overlay.area(area, 0x00ff00, 0.2);
  expect(overlay.group.children[0].geometry.parameters.thetaLength).toBeCloseTo(Math.PI / 2);
  expect(inArea({ x: 2, y: 10.9, z: 3 }, area)).toBe(true);
  expect(inArea({ x: 2, y: 0.99, z: 3 }, area)).toBe(false);
  expect(inArea({ x: 12.1, y: 1, z: 3 }, area)).toBe(false);
  overlay.dispose();
});

test('wall aiming remains horizontal while point range still includes altitude', () => {
  const profile = validateTargetingProfile({
    version: 1,
    kind: 'area',
    rangeFeet: 120,
    shape: 'wall',
    sizeFeet: 60,
    widthFeet: 1,
    heightFeet: 20,
  });
  const area = areaPlacement(
    profile,
    { world: { x: 0, y: 0, z: 0 }, facingAngle: 0 },
    {
      origin: { x: 2, y: 1, z: 3 },
      aim: { x: 4, y: 50, z: 3 },
    },
    1
  );
  expect(area.direction).toEqual({ x: 1, y: 0, z: 0 });
  expect(area).toMatchObject({ size: 12, width: 0.2, height: 4 });
});

test('chosen area recipients require exclusions before confirmation if there are too many', () => {
  const actor = {
    id: 'caster',
    name: 'Caster',
    world: { x: 0, y: 0, z: 0 },
    conditions: [],
    facingAngle: 0,
    creatureType: 'humanoid',
    creatureSize: 'medium',
  };
  const tokens = [
    actor,
    ...Array.from({ length: 7 }, (_, index) => ({
      ...actor,
      id: `target-${index}`,
      name: `Target ${index}`,
      world: { x: index * 0.2, y: 0, z: 0 },
    })),
  ];
  const board = {
    tokens,
    tileSize: 1,
    inside: () => true,
    clearPoint: () => true,
    clearArea: () => true,
  };
  const profile = validateTargetingProfile({
    version: 1,
    kind: 'area',
    rangeFeet: 60,
    shape: 'sphere',
    sizeFeet: 30,
    allowExclusions: true,
    maxAreaTargets: 6,
  });
  expect(() =>
    validateTargetSelection(board, actor, profile, {
      origin: actor.world,
      targets: [],
    })
  ).toThrow('at most 6');
  const selected = validateTargetSelection(board, actor, profile, {
    origin: actor.world,
    targets: [],
    exclusions: ['target-5', 'target-6'],
  });
  expect(selected.targets).toHaveLength(6);
  expect(selected.targets.some((target) => target.tokenId === 'target-5')).toBe(false);
});

test('persistent point and recipient reminders are non-pickable and behind transparent creature visuals', () => {
  const overlay = new TargetingOverlay(three, new three.Scene());
  const board = {
    tileSize: 1,
    tokens: [{ id: 'target', world: { x: 1, y: 5, z: 2 }, groundWorld: { x: 1, y: 0, z: 2 } }],
  };
  overlay.update(board, null, null, null, [
    { kind: 'targets', targetTokenIds: ['target'] },
    { kind: 'point', sourceId: 'spell:mage-hand', origin: { x: 3, y: 1, z: 2 } },
  ]);
  const meshes = overlay.group.getObjectsByProperty('isMesh', true);
  expect(meshes).toHaveLength(2);
  expect(meshes[0].position.y).toBeCloseTo(5.025);
  expect(meshes[1].position.y).toBeCloseTo(1.025);
  for (const mesh of meshes) {
    expect(mesh.material.depthTest).toBe(true);
    expect(mesh.material.depthWrite).toBe(false);
    expect(mesh.parent.renderOrder).toBeLessThan(0);
    const hits = [];
    mesh.raycast(new three.Raycaster(), hits);
    expect(hits).toEqual([]);
  }
  overlay.dispose();
});
