import {
  Body,
  Box,
  ContactMaterial,
  ConvexPolyhedron,
  Cylinder,
  Material,
  Plane,
  Quaternion,
  SAPBroadphase,
  Vec3,
  World,
} from 'cannon-es';

export const D20_FIXED_STEP = 1 / 120;
const MAX_ROLL_SECONDS = 6;

function addTerrain(world, heights, tileSize, radius, material) {
  const rows = heights.length;
  const cols = heights[0].length;
  const bottom = Math.min(...heights.flat()) - Math.max(radius * 3, tileSize * 4);
  const visited = Array.from({ length: rows }, () => new Uint8Array(cols));
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      if (visited[y][x]) continue;
      const top = heights[y][x];
      let width = 1;
      while (x + width < cols && !visited[y][x + width] && heights[y][x + width] === top) {
        width += 1;
      }
      let depth = 1;
      while (
        y + depth < rows &&
        Array.from({ length: width }, (_, i) => x + i).every(
          (column) => !visited[y + depth][column] && heights[y + depth][column] === top
        )
      ) {
        depth += 1;
      }
      for (let row = y; row < y + depth; row += 1) {
        for (let column = x; column < x + width; column += 1) visited[row][column] = 1;
      }
      world.addBody(
        new Body({
          mass: 0,
          material,
          position: new Vec3(
            (x + width / 2) * tileSize,
            (top + bottom) / 2,
            (y + depth / 2) * tileSize
          ),
          shape: new Box(
            new Vec3((width * tileSize) / 2, (top - bottom) / 2, (depth * tileSize) / 2)
          ),
        })
      );
    }
  }
}

function addBoundary(world, x, z, rotation, material) {
  world.addBody(
    new Body({
      mass: 0,
      material,
      shape: new Plane(),
      position: new Vec3(x, 0, z),
      quaternion: new Quaternion().setFromEuler(...rotation),
    })
  );
}

export function createD20Simulation({
  geometry,
  scale,
  metrics,
  groundHeights,
  obstacles = [],
  random = Math.random,
}) {
  const tileSize = metrics.tileSize;
  const width = metrics.cols * tileSize;
  const depth = metrics.rows * tileSize;
  const radius = geometry.radius * scale;
  if (!(scale > 0) || !(tileSize > 0) || width <= radius * 2 || depth <= radius * 2) {
    throw new Error('The board is too small for the large d20');
  }
  if (
    groundHeights.length !== metrics.rows ||
    groundHeights.some(
      (row) => row.length !== metrics.cols || row.some((height) => !Number.isFinite(height))
    )
  ) {
    throw new Error('Invalid terrain snapshot for d20 physics');
  }

  const world = new World({ gravity: new Vec3(0, -30 * tileSize, 0), allowSleep: true });
  world.broadphase = new SAPBroadphase(world);
  world.broadphase.useBoundingBoxes = true;
  world.solver.iterations = 20;
  world.solver.tolerance = 1e-7;
  const dieMaterial = new Material('d20');
  const boardMaterial = new Material('board');
  const wallMaterial = new Material('d20-wall');
  world.addContactMaterial(
    new ContactMaterial(dieMaterial, boardMaterial, {
      friction: 0.5,
      restitution: 0.28,
      contactEquationStiffness: 1e7,
      contactEquationRelaxation: 4,
    })
  );
  world.addContactMaterial(
    new ContactMaterial(dieMaterial, wallMaterial, {
      friction: 0.2,
      restitution: 0.45,
      contactEquationStiffness: 1e7,
      contactEquationRelaxation: 4,
    })
  );
  addTerrain(world, groundHeights, tileSize, radius, boardMaterial);
  addBoundary(world, 0, 0, [0, Math.PI / 2, 0], wallMaterial);
  addBoundary(world, width, 0, [0, -Math.PI / 2, 0], wallMaterial);
  addBoundary(world, 0, 0, [0, 0, 0], wallMaterial);
  addBoundary(world, 0, depth, [0, Math.PI, 0], wallMaterial);
  for (const obstacle of obstacles) {
    if (!(obstacle.radius > 0)) continue;
    const x = Math.min(Math.max(Math.floor(obstacle.x / tileSize), 0), metrics.cols - 1);
    const y = Math.min(Math.max(Math.floor(obstacle.z / tileSize), 0), metrics.rows - 1);
    const height = tileSize * (obstacle.type === 'tree' ? 2 : 1);
    world.addBody(
      new Body({
        mass: 0,
        material: boardMaterial,
        position: new Vec3(obstacle.x, groundHeights[y][x] + height / 2, obstacle.z),
        shape: new Cylinder(obstacle.radius, obstacle.radius, height, 8),
      })
    );
  }

  const shape = new ConvexPolyhedron({
    vertices: geometry.vertices.map((v) => new Vec3(v.x * scale, v.y * scale, v.z * scale)),
    faces: geometry.faces,
    normals: geometry.numberedFaces.map(
      (face) => new Vec3(face.normal.x, face.normal.y, face.normal.z)
    ),
  });
  const margin = radius + tileSize * 0.02;
  const xSpan = Math.max(width - margin * 2, 0);
  const zSpan = Math.max(depth - margin * 2, 0);
  const edge = Math.floor(random() * 4);
  let x = margin + random() * xSpan;
  let z = margin + random() * zSpan;
  if (edge === 0) x = margin;
  if (edge === 1) x = width - margin;
  if (edge === 2) z = margin;
  if (edge === 3) z = depth - margin;
  const targetX = width * (0.35 + random() * 0.3);
  const targetZ = depth * (0.35 + random() * 0.3);
  const dx = targetX - x;
  const dz = targetZ - z;
  const distance = Math.hypot(dx, dz) || 1;
  const direction = { x: dx / distance, z: dz / distance };
  const crossingSpan = edge < 2 ? xSpan : zSpan;
  const speed = Math.min(
    Math.max(tileSize * 12, crossingSpan * (1.05 + random() * 0.2)),
    Math.max(crossingSpan, tileSize) * 3
  );
  const u1 = random();
  const u2 = random() * Math.PI * 2;
  const u3 = random() * Math.PI * 2;
  const quaternion = new Quaternion(
    Math.sqrt(1 - u1) * Math.sin(u2),
    Math.sqrt(1 - u1) * Math.cos(u2),
    Math.sqrt(u1) * Math.sin(u3),
    Math.sqrt(u1) * Math.cos(u3)
  );
  const body = new Body({
    mass: 1,
    material: dieMaterial,
    shape,
    position: new Vec3(x, Math.max(...groundHeights.flat()) + radius * 1.2, z),
    quaternion,
    linearDamping: 0.22,
    angularDamping: 0.35,
    allowSleep: true,
    sleepSpeedLimit: 0.2,
    sleepTimeLimit: 0.25,
  });
  body.velocity.set(direction.x * speed, tileSize * (1 + random()), direction.z * speed);
  const spin = (speed / radius) * (1.25 + random() * 0.5);
  body.angularVelocity.set(
    direction.z * spin + (random() - 0.5),
    (random() - 0.5) * spin * 0.35,
    -direction.x * spin + (random() - 0.5)
  );
  world.addBody(body);

  const transformedNormal = new Vec3();
  const hasClearFace = () => {
    let highest = -1;
    let runnerUp = -1;
    for (const normal of shape.faceNormals) {
      body.quaternion.vmult(normal, transformedNormal);
      const alignment = transformedNormal.y;
      if (alignment > highest) {
        runnerUp = highest;
        highest = alignment;
      } else if (alignment > runnerUp) {
        runnerUp = alignment;
      }
    }
    return highest > 0.95 && highest - runnerUp > 0.08;
  };
  let accumulator = 0;
  let cockedDuration = 0;
  const simulation = {
    body,
    world,
    alpha: 0,
    cocked: false,
    get settled() {
      return body.sleepState === Body.SLEEPING && hasClearFace();
    },
    get finished() {
      return simulation.settled || simulation.cocked;
    },
    advance(delta) {
      if (!Number.isFinite(delta) || delta < 0) throw new Error('Invalid d20 physics frame delta');
      accumulator += delta;
      let steps = 0;
      // Cannon's render-time-budgeted stepping can discard time, so own the fixed-step accumulator.
      while (accumulator >= D20_FIXED_STEP - 1e-10 && !simulation.finished && steps < 240) {
        const touchingSurface = world.contacts.some(
          (contact) => contact.bi === body || contact.bj === body
        );
        body.linearDamping = touchingSurface ? 0.4 : 0.22;
        body.angularDamping = touchingSurface ? 0.6 : 0.35;
        body.allowSleep = hasClearFace();
        if (!body.allowSleep && body.sleepState !== Body.AWAKE) body.wakeUp();
        world.step(D20_FIXED_STEP);
        accumulator = Math.max(accumulator - D20_FIXED_STEP, 0);
        steps += 1;
        const speedSquared = body.velocity.lengthSquared() + body.angularVelocity.lengthSquared();
        cockedDuration =
          !hasClearFace() && speedSquared < body.sleepSpeedLimit ** 2
            ? cockedDuration + D20_FIXED_STEP
            : 0;
        if (cockedDuration >= 0.65) {
          simulation.cocked = true;
          body.sleep();
        }
        if (world.time >= MAX_ROLL_SECONDS && !simulation.finished) {
          throw new Error('The d20 did not settle; roll again');
        }
      }
      simulation.alpha = Math.min(accumulator / D20_FIXED_STEP, 1);
      return simulation.finished;
    },
  };
  return simulation;
}
