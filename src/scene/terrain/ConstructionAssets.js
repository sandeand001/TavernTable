import {
  BUILDING_SIDES,
  buildingFeetToLocal,
  buildingLevelElevation,
  buildingLevels,
  buildingLocalToFeet,
  buildingWallApertures,
  buildingWallPoint,
} from '../../terrain/BuildingModel.js';

const VILLAGE_FACADE = 'source-medieval-wall-door';
const VILLAGE_WALL_PANEL = 'source-medieval-wall-straight';
const DUNGEON_WALL = 'source-dungeon-wall';
const DUNGEON_WALL_MODULE_FEET = 10;
const ROOF_OVERHANG_FEET = 1.25;
const FACADE_OFFSET_FEET = 0.02;
const WALL_PANEL_DEPTH_FEET = 0.65;
const WALL_PANEL_WIDTH_FEET = 6.4;
// Outer top plank of Wall_Plaster_Straight, in story fractions and texture coordinates.
const FASCIA = Object.freeze({ bottom: 0.92337, top: 0.9981, vBottom: 0.11726, vTop: 0.00383 });
const EPSILON = 1e-6;
const SIDE_YAW = Object.freeze({ south: 0, north: Math.PI, east: Math.PI / 2, west: -Math.PI / 2 });
const VILLAGE_MODULES = Object.freeze([
  VILLAGE_WALL_PANEL,
  'source-medieval-roof',
  'source-medieval-roof-front',
  'source-medieval-balcony',
]);
const wallPatchGeometry = new WeakMap();
const sideSpan = (spec, side) =>
  side === 'north' || side === 'south' ? spec.lengthFeet : spec.widthFeet;

function rootBounds(three, model) {
  model.updateMatrixWorld(true);
  return new three.Box3().setFromObject(model, true);
}

export function isVillageExterior(spec) {
  return (
    spec.kind === 'building' && !spec.ruined && spec.appearance?.facadeModelKey === VILLAGE_FACADE
  );
}

export function isDungeonWall(spec) {
  return (
    spec.kind === 'wall' &&
    spec.style === 'plain' &&
    !spec.ruined &&
    !spec.wallStairs &&
    (!spec.openingShape || spec.openingShape === 'rectangular') &&
    spec.appearance?.facadeModelKey === DUNGEON_WALL
  );
}

export function clipConstructionReplacementFace({ source, points, replacements } = {}) {
  if (!source?.structureId) return [points];
  const replacement = replacements?.find((entry) => entry.structureId === source.structureId);
  if (!replacement?.fullExterior) return [points];
  const spec = replacement.spec;
  if (isDungeonWall(spec)) return source.id === `${spec.id}-wall` ? [] : [points];
  if (source.layerId === 'roof' && spec.building?.roof === 'gable') return [];
  if (source.layerId === 'balcony' && replacement.replaceRails && source.id.endsWith('-rail'))
    return [];
  if (source.id !== `${spec.id}-shell`) return [points];
  // Keep the inner shell, window/door reveals and structural caps. Only the outer faces are clad.
  const local = points.map((point) =>
    buildingFeetToLocal(
      spec,
      Array.isArray(point) ? { x: point[0], y: point[1], z: point[2] } : point
    )
  );
  const outer = (axis, value) => local.every((point) => Math.abs(point[axis] - value) < 1e-5);
  return ['x', 'z'].some((axis) =>
    [-1, 1].some((sign) =>
      outer(axis, (sign * (axis === 'x' ? spec.lengthFeet : spec.widthFeet)) / 2)
    )
  )
    ? []
    : [points];
}

function instanceRepeatedMeshes(three, group) {
  if (!three.InstancedMesh) return;
  group.updateMatrixWorld(true);
  const buckets = new Map();
  const materialIds = new WeakMap();
  let nextMaterialId = 1;
  for (const root of group.children) {
    root.traverse((child) => {
      if (!child.isMesh || !child.geometry || !child.material) return;
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      if (materials.some((material) => !material)) return;
      const ids = materials.map((material) => {
        let id = materialIds.get(material);
        if (!id) {
          id = nextMaterialId++;
          materialIds.set(material, id);
        }
        return id;
      });
      const key = `${child.geometry.uuid}:${ids.join(',')}`;
      const bucket = buckets.get(key) ?? {
        geometry: child.geometry,
        material: child.material,
        key,
        meshes: [],
      };
      bucket.meshes.push(child);
      buckets.set(key, bucket);
    });
  }
  for (const bucket of buckets.values()) {
    if (bucket.meshes.length < 2) continue;
    const instanced = new three.InstancedMesh(
      bucket.geometry,
      bucket.material,
      bucket.meshes.length
    );
    instanced.name = `InstancedConstructionAsset:${bucket.key}`;
    instanced.castShadow = bucket.meshes.some((mesh) => mesh.castShadow);
    instanced.receiveShadow = bucket.meshes.some((mesh) => mesh.receiveShadow);
    instanced.raycast = () => {};
    instanced.userData.structureIds = bucket.meshes.map(
      (mesh) => mesh.userData.structureId ?? mesh.parent?.userData.structureId
    );
    bucket.meshes.forEach((mesh, index) => {
      instanced.setMatrixAt(index, mesh.matrixWorld);
      mesh.visible = false;
    });
    instanced.instanceMatrix.needsUpdate = true;
    group.add(instanced);
  }
}

export function releaseConstructionAssets(group) {
  group?.traverse((node) => {
    if (node.isInstancedMesh) node.dispose();
  });
  group?.removeFromParent();
}

function seatModel(three, model, point, worldUnitsPerFoot) {
  const placed = rootBounds(three, model);
  model.position.x += point.x * worldUnitsPerFoot - (placed.min.x + placed.max.x) / 2;
  model.position.y += point.y * worldUnitsPerFoot - placed.min.y;
  model.position.z += point.z * worldUnitsPerFoot - (placed.min.z + placed.max.z) / 2;
}

function placeRoof({ three, model, spec, worldUnitsPerFoot }) {
  const source = rootBounds(three, model);
  const size = {
    x: source.max.x - source.min.x,
    y: source.max.y - source.min.y,
    z: source.max.z - source.min.z,
  };
  if (![size.x, size.y, size.z].every((value) => Number.isFinite(value) && value > 0))
    throw new Error('Village roof module has invalid source bounds');
  model.scale.multiply(
    new three.Vector3(
      ((spec.widthFeet + ROOF_OVERHANG_FEET * 2) * worldUnitsPerFoot) / size.x,
      ((spec.building?.roofRiseFeet ?? 5) * worldUnitsPerFoot) / size.y,
      ((spec.lengthFeet + ROOF_OVERHANG_FEET * 2) * worldUnitsPerFoot) / size.z
    )
  );
  model.rotation.y = Math.PI / 2 - spec.angleRadians;
  seatModel(
    three,
    model,
    {
      x: spec.xFeet,
      y: spec.baseFeet + spec.heightFeet,
      z: spec.zFeet,
    },
    worldUnitsPerFoot
  );
}

function placeRoofEnd({ three, model, spec, worldUnitsPerFoot, end }) {
  const source = rootBounds(three, model);
  const size = {
    x: source.max.x - source.min.x,
    y: source.max.y - source.min.y,
    z: source.max.z - source.min.z,
  };
  if (![size.x, size.y, size.z].every((value) => Number.isFinite(value) && value > 0))
    throw new Error('Village gable-end module has invalid source bounds');
  const lap = 0.08;
  model.scale.multiply(
    new three.Vector3(
      (spec.widthFeet * worldUnitsPerFoot) / size.x,
      (spec.building.roofRiseFeet * worldUnitsPerFoot) / size.y,
      worldUnitsPerFoot / size.z
    )
  );
  model.rotation.y = end > 0 ? Math.PI / 2 - spec.angleRadians : -Math.PI / 2 - spec.angleRadians;
  const point = buildingLocalToFeet(spec, {
    // The gable belongs to the end wall. Only the tile roof extends to the overhang.
    x: (end * spec.lengthFeet) / 2,
    y: spec.heightFeet - lap,
    z: 0,
  });
  seatModel(three, model, point, worldUnitsPerFoot);
}

function placeBalconyRail({ three, model, spec, balcony, worldUnitsPerFoot, side }) {
  const size = rootBounds(three, model).getSize(new three.Vector3());
  if (![size.x, size.y, size.z].every((value) => Number.isFinite(value) && value > 0))
    throw new Error('Village balcony railing has invalid source bounds');
  const front = side === 'front';
  const railDepth = 0.35;
  const inset = railDepth / 2;
  const span = sideSpan(spec, balcony.side);
  const along = front ? 0 : (side === 'left' ? -1 : 1) * (balcony.widthFeet / 2 - inset);
  const local = buildingWallPoint(
    spec,
    balcony.side,
    balcony.u + along / span,
    front ? balcony.depthFeet - inset : balcony.depthFeet / 2,
    buildingLevelElevation(spec, balcony.floor)
  );
  model.scale.multiply(
    new three.Vector3(
      ((front ? balcony.widthFeet : balcony.depthFeet) * worldUnitsPerFoot) / size.x,
      (3 * worldUnitsPerFoot) / size.y,
      (railDepth * worldUnitsPerFoot) / size.z
    )
  );
  const sideDirection = ['north', 'east'].includes(balcony.side) ? -1 : 1;
  model.rotation.y =
    SIDE_YAW[balcony.side] -
    spec.angleRadians +
    (front ? 0 : sideDirection * (side === 'left' ? -Math.PI / 2 : Math.PI / 2));
  seatModel(three, model, buildingLocalToFeet(spec, local), worldUnitsPerFoot);
}

function addExteriorModule(group, model, spec, modelKey) {
  model.userData.structureId = spec.id;
  model.userData.facadeModelKey = spec.appearance?.facadeModelKey;
  model.userData.renderOnly = true;
  model.name = `ConstructionAsset:${spec.id}:${modelKey}`;
  model.raycast = () => {};
  model.traverse((child) => {
    if (!child.isMesh) return;
    child.userData.structureId = spec.id;
    child.castShadow = true;
    child.receiveShadow = true;
    child.raycast = () => {};
  });
  group.add(model);
}

function addDungeonWall({ group, three, source, spec, worldUnitsPerFoot }) {
  const size = rootBounds(three, source).getSize(new three.Vector3());
  if (![size.x, size.y, size.z].every((value) => Number.isFinite(value) && value > 0))
    throw new Error('Dungeon wall module has invalid source bounds');
  const openingWidth = spec.openingWidthFeet ?? 7.5;
  const openingHeight = spec.openingHeightFeet ?? Math.min(8, spec.heightFeet - 1);
  const sideWidth = (spec.lengthFeet - openingWidth) / 2;
  const pieces = spec.opening
    ? [
        { x: -(openingWidth + sideWidth) / 2, y: 0, width: sideWidth, height: spec.heightFeet },
        { x: (openingWidth + sideWidth) / 2, y: 0, width: sideWidth, height: spec.heightFeet },
        {
          x: 0,
          y: openingHeight,
          width: openingWidth,
          height: spec.heightFeet - openingHeight,
        },
      ]
    : [{ x: 0, y: 0, width: spec.lengthFeet, height: spec.heightFeet }];
  for (const piece of pieces) {
    const count = Math.ceil(piece.width / DUNGEON_WALL_MODULE_FEET);
    const width = piece.width / count;
    for (let index = 0; index < count; index++) {
      const model = source.clone(true);
      model.scale.multiply(
        new three.Vector3(
          (width * worldUnitsPerFoot) / size.x,
          (piece.height * worldUnitsPerFoot) / size.y,
          (spec.widthFeet * worldUnitsPerFoot) / size.z
        )
      );
      model.rotation.y = -spec.angleRadians;
      seatModel(
        three,
        model,
        buildingLocalToFeet(spec, {
          x: piece.x - piece.width / 2 + width * (index + 0.5),
          y: piece.y,
          z: 0,
        }),
        worldUnitsPerFoot
      );
      addExteriorModule(group, model, spec, DUNGEON_WALL);
    }
  }
}

async function loadVillageModules(modelAssetCache, strict) {
  const entries = await Promise.all(
    VILLAGE_MODULES.map(async (key) => [key, await modelAssetCache.getModel(key)])
  );
  const missing = entries.filter(([, model]) => !model).map(([key]) => key);
  if (missing.length) {
    if (strict) throw new Error(`Missing construction models: ${missing.join(', ')}`);
    return null;
  }
  return Object.fromEntries(entries);
}

function prepareWallPanel(three, model) {
  const bounds = rootBounds(three, model);
  const size = bounds.getSize(new three.Vector3());
  let plaster, timber;
  model.traverse((node) => {
    if (node.isMesh && node.material?.name === 'MI_Plaster') plaster = node;
    if (node.isMesh && node.material?.name === 'MI_WoodTrim') timber = node;
  });
  if (!plaster || ![size.x, size.y, size.z].every((value) => Number.isFinite(value) && value > 0))
    throw new Error('Village wall module needs a measurable plaster surface');
  const plasterFace = new three.Box3().setFromObject(plaster, true).max.z;
  const scaleZ = WALL_PANEL_DEPTH_FEET / size.z;
  return {
    model,
    size,
    material: plaster.material,
    offset: FACADE_OFFSET_FEET - (plasterFace - (bounds.min.z + bounds.max.z) / 2) * scaleZ,
    fascia: timber
      ? {
          material: timber.material,
          offset: FACADE_OFFSET_FEET + (bounds.max.z - plasterFace) * scaleZ,
        }
      : null,
  };
}

function addWallSide({ group, three, panel, spec, side, levels, apertures, worldUnitsPerFoot }) {
  const span = sideSpan(spec, side);
  // Wrap the offset plaster faces around the corner rather than leaving a slot between them.
  const end = span / 2 + FACADE_OFFSET_FEET;
  const openings = apertures
    .filter((opening) => opening.side === side)
    .map((opening) => {
      const center = (opening.u - 0.5) * span;
      return {
        ...opening,
        low: center - opening.widthFeet / 2,
        high: center + opening.widthFeet / 2,
      };
    })
    .sort((a, b) => a.bottom - b.bottom);
  const plane = (u, width, lowY, highY, yaw, offset, material, fascia = false) => {
    if (highY - lowY <= EPSILON) return;
    if (!wallPatchGeometry.has(three)) {
      const plaster = new three.PlaneGeometry(1, 1);
      const timber = plaster.clone();
      const uv = timber.getAttribute('uv');
      for (let i = 0; i < uv.count; i++) uv.setY(i, uv.getY(i) ? FASCIA.vTop : FASCIA.vBottom);
      wallPatchGeometry.set(three, { plaster, timber });
    }
    const geometry = wallPatchGeometry.get(three);
    const patch = new three.Mesh(fascia ? geometry.timber : geometry.plaster, material);
    patch.scale.set(width * worldUnitsPerFoot, (highY - lowY) * worldUnitsPerFoot, 1);
    patch.rotation.y = yaw;
    const point = buildingLocalToFeet(
      spec,
      buildingWallPoint(spec, side, u, offset, (lowY + highY) / 2)
    );
    patch.position.set(
      point.x * worldUnitsPerFoot,
      point.y * worldUnitsPerFoot,
      point.z * worldUnitsPerFoot
    );
    addExteriorModule(
      group,
      patch,
      spec,
      fascia ? 'village-fascia-infill' : 'village-aperture-infill'
    );
  };
  const place = (low, high, bottom, top, fullPanel, fasciaRange) => {
    if (top - bottom <= EPSILON || high - low <= EPSILON) return;
    const u = 0.5 + (low + high) / (2 * span);
    const yaw = SIDE_YAW[side] - spec.angleRadians;
    if (fullPanel) {
      const model = panel.model.clone(true);
      model.scale.multiply(
        new three.Vector3(
          ((high - low) * worldUnitsPerFoot) / panel.size.x,
          ((top - bottom) * worldUnitsPerFoot) / panel.size.y,
          (WALL_PANEL_DEPTH_FEET * worldUnitsPerFoot) / panel.size.z
        )
      );
      model.rotation.y = yaw;
      seatModel(
        three,
        model,
        buildingLocalToFeet(spec, buildingWallPoint(spec, side, u, panel.offset, bottom)),
        worldUnitsPerFoot
      );
      addExteriorModule(group, model, spec, VILLAGE_WALL_PANEL);
    } else {
      // Panels from the pack have fixed apertures. Use the same plaster at the exact lintel/sill.
      plane(u, high - low, bottom, top, yaw, FACADE_OFFSET_FEET, panel.material);
      if (panel.fascia && fasciaRange)
        plane(
          u,
          high - low,
          Math.max(bottom, fasciaRange[0]),
          fasciaRange[1],
          yaw,
          panel.fascia.offset,
          panel.fascia.material,
          true
        );
    }
  };
  for (const [index, { elevationFeet: bottom }] of levels.entries()) {
    const top = levels[index + 1]?.elevationFeet ?? spec.heightFeet;
    const active = openings.filter((opening) => opening.bottom < top && opening.top > bottom);
    const cuts = [...new Set([-end, end, ...active.flatMap(({ low, high }) => [low, high])])].sort(
      (a, b) => a - b
    );
    for (let i = 1; i < cuts.length; i++) {
      const low = cuts[i - 1],
        high = cuts[i];
      if (high - low <= EPSILON) continue;
      const holes = active.filter(
        (opening) => opening.low < high - EPSILON && opening.high > low + EPSILON
      );
      if (!holes.length) {
        const count = Math.ceil((high - low) / WALL_PANEL_WIDTH_FEET);
        const width = (high - low) / count;
        for (let j = 0; j < count; j++)
          place(low + j * width, low + (j + 1) * width, bottom, top, true);
        continue;
      }
      let y = bottom;
      for (const hole of holes) {
        place(low, high, y, Math.min(top, hole.bottom), false);
        y = Math.max(y, hole.top);
      }
      const fascia = [FASCIA.bottom, FASCIA.top].map(
        (fraction) => bottom + (top - bottom) * fraction
      );
      place(low, high, y, top, false, fascia);
    }
  }
}

export async function buildConstructionAssets({
  specs = [],
  three,
  worldUnitsPerFoot,
  visibleLayers = null,
  modelAssetCache,
  strict = false,
} = {}) {
  if (!three?.Group) throw new Error('Construction assets require Three.js');
  const group = new three.Group();
  group.name = 'ConstructionAssets';
  group.userData.renderOnly = true;
  group.userData.replacements = [];
  if (!Number.isFinite(worldUnitsPerFoot) || worldUnitsPerFoot <= 0 || !modelAssetCache?.getModel) {
    if (strict && specs.some((spec) => isVillageExterior(spec) || isDungeonWall(spec)))
      throw new Error('Construction model preparation requires a model cache and a valid scale');
    return group;
  }
  const wallVisible = !visibleLayers || visibleLayers.includes('ground');
  const roofVisible = !visibleLayers || visibleLayers.includes('roof');
  const balconyVisible = !visibleLayers || visibleLayers.includes('balcony');
  const dungeonVisible = !visibleLayers || visibleLayers.includes('castle');
  if (!wallVisible && !roofVisible && !balconyVisible && !dungeonVisible) return group;

  const exteriors = specs.filter(isVillageExterior);
  const dungeonWalls = dungeonVisible ? specs.filter(isDungeonWall) : [];
  if (!exteriors.length && !dungeonWalls.length) return group;
  const [modules, dungeonModel] = await Promise.all([
    exteriors.length && (wallVisible || roofVisible || balconyVisible)
      ? loadVillageModules(modelAssetCache, strict)
      : null,
    dungeonWalls.length ? modelAssetCache.getModel(DUNGEON_WALL) : null,
  ]);
  if (strict && dungeonWalls.length && !dungeonModel)
    throw new Error(`Missing construction model: ${DUNGEON_WALL}`);
  const panel =
    modules && wallVisible ? prepareWallPanel(three, modules[VILLAGE_WALL_PANEL]) : null;

  for (const spec of modules ? exteriors : []) {
    if (panel) {
      const levels = buildingLevels(spec, { includeDeck: false });
      const apertures = buildingWallApertures(spec);
      for (const side of BUILDING_SIDES)
        addWallSide({
          group,
          three,
          panel,
          spec,
          side,
          levels,
          apertures,
          worldUnitsPerFoot,
        });
    }
    if (roofVisible && spec.building?.roof === 'gable') {
      const roof = modules['source-medieval-roof'].clone(true);
      placeRoof({ three, model: roof, spec, worldUnitsPerFoot });
      addExteriorModule(group, roof, spec, 'source-medieval-roof');
      for (const end of [-1, 1]) {
        const front = modules['source-medieval-roof-front'].clone(true);
        placeRoofEnd({ three, model: front, spec, worldUnitsPerFoot, end });
        addExteriorModule(group, front, spec, 'source-medieval-roof-front');
      }
    }
    if (balconyVisible)
      for (const balcony of spec.building?.balconies ?? []) {
        for (const side of ['front', 'left', 'right']) {
          const balconyModel = modules['source-medieval-balcony'].clone(true);
          placeBalconyRail({
            three,
            model: balconyModel,
            spec,
            balcony,
            worldUnitsPerFoot,
            side,
          });
          addExteriorModule(group, balconyModel, spec, `source-medieval-balcony-${side}`);
        }
      }
    group.userData.replacements.push({
      structureId: spec.id,
      spec,
      fullExterior: true,
      modelKey: VILLAGE_FACADE,
      replaceRails: balconyVisible,
    });
  }
  if (dungeonModel)
    for (const spec of dungeonWalls) {
      addDungeonWall({ group, three, source: dungeonModel, spec, worldUnitsPerFoot });
      group.userData.replacements.push({
        structureId: spec.id,
        spec,
        fullExterior: true,
        modelKey: DUNGEON_WALL,
      });
    }
  instanceRepeatedMeshes(three, group);
  return group;
}
