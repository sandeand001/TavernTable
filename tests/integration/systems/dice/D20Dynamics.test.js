import * as three from 'three';
import { Body, ConvexPolyhedron, Vec3 } from 'cannon-es';
import { createD20Simulation, D20_FIXED_STEP } from '../../../../src/systems/dice/D20Dynamics.js';
import { getD20ColliderData, resolveUpFacingFace } from '../../../../src/systems/dice/DiceState.js';
import { loadD20Model } from '../../../helpers/d20-model.js';

const model = loadD20Model();
const geometry = getD20ColliderData(model, three);

function simulate(seed, { cols = 25, rows = 25, height = () => 0, obstacles = [] } = {}) {
  let value = seed >>> 0;
  const random = () => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    return value / 4294967296;
  };
  const simulation = createD20Simulation({
    geometry,
    scale: 3.6,
    metrics: { cols, rows, tileSize: 1 },
    groundHeights: Array.from({ length: rows }, (_, y) =>
      Array.from({ length: cols }, (_, x) => height(x, y))
    ),
    obstacles,
    random,
  });
  try {
    while (!simulation.settled && !simulation.cocked) simulation.advance(D20_FIXED_STEP);
  } catch (error) {
    throw new Error(
      `${error.message}; seed=${seed}, position=${simulation.body.position.toString()}, ` +
        `velocity=${simulation.body.velocity.toString()}, angular=${simulation.body.angularVelocity.toString()}`,
      { cause: error }
    );
  }
  const mesh = model.clone(true);
  mesh.scale.setScalar(3.6);
  mesh.position.copy(simulation.body.position);
  mesh.quaternion.copy(simulation.body.quaternion);
  return { simulation, mesh, face: simulation.cocked ? null : resolveUpFacingFace(mesh, three) };
}

describe('Large d20 rigid-body simulation', () => {
  test('launches with a firm forward roll rather than a gentle vertical drop', () => {
    const simulation = createD20Simulation({
      geometry,
      scale: 3.6,
      metrics: { cols: 25, rows: 25, tileSize: 1 },
      groundHeights: Array.from({ length: 25 }, () => Array(25).fill(0)),
      random: () => 0.5,
    });
    const { velocity, angularVelocity } = simulation.body;
    const forwardSpeed = Math.hypot(velocity.x, velocity.z);
    const tumbleSpeed = Math.hypot(angularVelocity.x, angularVelocity.z);

    expect(forwardSpeed).toBeGreaterThanOrEqual(10);
    expect(forwardSpeed / velocity.y).toBeGreaterThanOrEqual(4);
    expect(tumbleSpeed).toBeGreaterThanOrEqual(forwardSpeed / (geometry.radius * 3.6));
    expect(Math.abs(angularVelocity.y)).toBeLessThan(tumbleSpeed * 0.25);
  });

  test.each([25, 50])('scales launch momentum to cross a %s-tile board', (size) => {
    const simulation = createD20Simulation({
      geometry,
      scale: 3.6,
      metrics: { cols: size, rows: size, tileSize: 1 },
      groundHeights: Array.from({ length: size }, () => Array(size).fill(0)),
      random: () => 0.5,
    });
    const usableSpan = size - 2 * (geometry.radius * 3.6 + 0.02);

    expect(Math.hypot(simulation.body.velocity.x, simulation.body.velocity.z)).toBeGreaterThan(
      usableSpan
    );
  });

  test('cross-board throws can reach and visibly rebound from a far wall', () => {
    let rebounds = 0;
    for (const seed of [1, 2, 8, 17, 42, 99, 321, 12345]) {
      let value = seed >>> 0;
      const simulation = createD20Simulation({
        geometry,
        scale: 3.6,
        metrics: { cols: 25, rows: 25, tileSize: 1 },
        groundHeights: Array.from({ length: 25 }, () => Array(25).fill(0)),
        random: () => {
          value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
          return value / 4294967296;
        },
      });
      const start = simulation.body.position.clone();
      const previousVelocity = simulation.body.velocity.clone();
      let wallNormal = null;
      let rebounded = false;
      simulation.body.addEventListener('collide', ({ body }) => {
        if (body.material?.name !== 'd20-wall') return;
        const normal = body.quaternion.vmult(new Vec3(0, 0, 1));
        if (normal.dot(start.vsub(body.position)) < 15) return;
        if (previousVelocity.dot(normal) < -1) wallNormal = normal;
      });
      while (!simulation.finished) {
        previousVelocity.copy(simulation.body.velocity);
        simulation.advance(D20_FIXED_STEP);
        if (wallNormal && simulation.body.velocity.dot(wallNormal) > 1) rebounded = true;
      }
      if (rebounded) rebounds += 1;
    }

    expect(rebounds).toBeGreaterThanOrEqual(4);
  });

  test.each([1, 2, 7, 8, 17, 42, 99, 321, 12345])(
    'seed %s naturally sleeps with a readable face and no penetration',
    (seed) => {
      const { simulation, mesh, face } = simulate(seed);
      const bounds = new three.Box3().setFromObject(mesh, true);

      expect(simulation.body.shapes[0]).toBeInstanceOf(ConvexPolyhedron);
      expect(simulation.body.sleepState).toBe(Body.SLEEPING);
      expect(simulation.world.time).toBeLessThan(5);
      expect(face.value).toBeGreaterThanOrEqual(1);
      expect(face.value).toBeLessThanOrEqual(20);
      const supportedByWall = simulation.world.contacts.some(
        (contact) =>
          (contact.bi === simulation.body || contact.bj === simulation.body) &&
          (contact.bi === simulation.body ? contact.bj : contact.bi).material?.name === 'd20-wall'
      );
      expect(face.score).toBeGreaterThan(supportedByWall ? 0.95 : 0.995);
      const alignments = geometry.numberedFaces
        .map((numberedFace) => numberedFace.normal.clone().applyQuaternion(mesh.quaternion).y)
        .sort((a, b) => b - a);
      expect(alignments[0] - alignments[1]).toBeGreaterThan(0.08);
      expect(bounds.min.y).toBeGreaterThan(-0.06);
      expect(bounds.min.y).toBeLessThan(0.06);
      expect(bounds.min.x).toBeGreaterThan(-0.03);
      expect(bounds.max.x).toBeLessThan(25.03);
      expect(bounds.min.z).toBeGreaterThan(-0.03);
      expect(bounds.max.z).toBeLessThan(25.03);
    }
  );

  test.each([2, 8, 42])('seed %s settles on a small terraced board', (seed) => {
    const { simulation, face, mesh } = simulate(seed, {
      cols: 12,
      rows: 8,
      height: (x) => (x >= 6 ? 2.4 : 0),
    });
    expect(simulation.world.time).toBeLessThan(6);
    expect(face.value).toBeGreaterThanOrEqual(1);
    expect(face.value).toBeLessThanOrEqual(20);
    expect(mesh.position.toArray().every(Number.isFinite)).toBe(true);
  });

  test('settles after interacting with a fixed obstacle', () => {
    const { simulation, face } = simulate(42, {
      obstacles: [{ type: 'token', x: 12, z: 12, radius: 0.45 }],
    });
    expect(simulation.settled).toBe(true);
    expect(face.value).toBeGreaterThanOrEqual(1);
    expect(face.value).toBeLessThanOrEqual(20);
  });

  test('recognizes a stationary cocked die without choosing either upward face', () => {
    const simulation = createD20Simulation({
      geometry,
      scale: 3.6,
      metrics: { cols: 12, rows: 8, tileSize: 1 },
      groundHeights: Array.from({ length: 8 }, () =>
        Array.from({ length: 12 }, (_, x) => (x >= 6 ? 2.4 : 0))
      ),
      random: () => 0.5,
    });
    // A recorded resting pose keeps this check independent of launch-strength tuning.
    simulation.body.position.set(2.286914386302262, 2.4604349744678022, 2.3285374739386873);
    simulation.body.quaternion.set(
      -0.15948114235644092,
      -0.08874382949622457,
      -0.027342650568343705,
      -0.9828238282718461
    );
    simulation.body.velocity.setZero();
    simulation.body.angularVelocity.setZero();
    simulation.body.aabbNeedsUpdate = true;
    while (!simulation.finished) simulation.advance(D20_FIXED_STEP);

    expect(simulation.cocked).toBe(true);
    expect(simulation.settled).toBe(false);
    expect(simulation.world.time).toBeLessThan(6);
  });

  test('an unsettled throw reports failure at the time limit instead of forcing a face', () => {
    const simulation = createD20Simulation({
      geometry,
      scale: 3.6,
      metrics: { cols: 25, rows: 25, tileSize: 1 },
      groundHeights: Array.from({ length: 25 }, () => Array(25).fill(0)),
      random: () => 0.5,
    });
    simulation.body.position.y = 10000;
    simulation.body.aabbNeedsUpdate = true;

    expect(() => {
      while (!simulation.finished) simulation.advance(D20_FIXED_STEP);
    }).toThrow('The d20 did not settle; roll again');
    expect(simulation.world.time).toBeCloseTo(6);
    expect(simulation.settled).toBe(false);
  });
});
