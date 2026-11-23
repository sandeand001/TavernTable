import { GRID_CONFIG } from '../config/GameConstants.js';
import { getBiomeGenerationVariant } from '../config/biome/BiomeGenerationFamilies.js';
import { CAVERN_BIOME_KEYS } from '../config/biome/BiomeConstants.js';
import { preview3DElevationUnit } from '../core/game-manager/internals/elevation.js';
import { prepareBiomePlacements } from '../scene/terrain/PrepareBiomePlacements.js';
import {
  buildConstructionAssets,
  isDungeonWall,
  isVillageExterior,
  releaseConstructionAssets,
} from '../scene/terrain/ConstructionAssets.js';
import { sameJsonValue } from '../utils/JsonValue.js';
import CampaignWorld from './CampaignWorld.js';
import { captureCampaignScene, isCampaignActionInProgress } from './SceneWorld.js';
import {
  captureBuildingContext,
  reconcileBuildingScene,
  buildingJoinConnections,
  prepareBuildingFloorGeometry,
} from './BuildingAssembly.js';
import { assertOtherMapsPreserved } from './CampaignBuildingEditor.js';
import { validateScene } from './CampaignScene.js';
import { cavernAreasOverlap } from './CavernAssembly.js';
import { mapLocationId } from './CampaignLocations.js';
import { ConnectionUnavailableError } from './CampaignConnections.js';
import { TerrainGeometry } from '../terrain/TerrainGeometry.js';
import { isTerrainCellSupported } from '../terrain/TerrainSupport.js';
import { createLogicalCavernNetwork, occupiedCavernSides } from './CampaignLogicalPassages.js';
import {
  CAVERN_SIDES,
  cavernExitsForCount,
  defaultCavernExits,
} from '../terrain/generation/CavernInteriors.js';
import { logicalPassageEndpoint } from './CampaignLogicalPassageTravel.js';

const copy = (value) => JSON.parse(JSON.stringify(value));

export function assertBiomeGenerationReady(gm, engine = gm?.terrainEngine) {
  if (
    !engine ||
    engine.isActive ||
    engine.isGenerating ||
    engine.hasPendingStroke ||
    gm.campaignViewBusy ||
    gm.campaignMapTransition ||
    gm.campaignMapFailure ||
    gm.sceneAutosave?.error ||
    gm.sceneAutosave?.writing ||
    gm.sceneAutosave?.ready === false ||
    gm.characterServices?.library?.isSaving ||
    gm.characterServices?.library?.pendingScenes > 0 ||
    isCampaignActionInProgress(gm)
  )
    throw new Error('Finish the current action or map change before generating a replacement');
}

function removeMapCreatures(scene, mapId) {
  const removed = new Set(
    scene.creatures.filter((creature) => creature.mapId === mapId).map((creature) => creature.id)
  );
  if (
    (scene.combat.effects || []).some(
      (effect) =>
        effect.kind === 'flight' &&
        removed.has(effect.casterTokenId) &&
        effect.targetTokenIds.some((id) => !removed.has(id))
    )
  )
    throw new Error(
      'Removing a creature would end flight for a creature on another map; resolve that effect before generating'
    );
  scene.creatures = scene.creatures.filter((creature) => !removed.has(creature.id));
  scene.combat.states = scene.combat.states.filter((state) => !removed.has(state.tokenId));
  if (removed.has(scene.combat.activeTokenId)) scene.combat.activeTokenId = null;
  scene.combat.effects = (scene.combat.effects || []).flatMap((effect) => {
    if (
      (effect.followCaster || effect.kind === 'flight' || effect.movement) &&
      removed.has(effect.casterTokenId)
    )
      return [];
    if (!['flight', 'targets'].includes(effect.kind)) return [effect];
    const targetTokenIds = effect.targetTokenIds.filter((id) => !removed.has(id));
    return targetTokenIds.length ? [{ ...effect, targetTokenIds }] : [];
  });
  if (removed.has(scene.view.focusTokenId)) scene.view.focusTokenId = null;
}

function validateRetainedConnections(before, after, context, ownerId) {
  const connections = (before.connections || []).filter(
    (connection) =>
      connection.feature.mapId === ownerId || connection.ends.some((end) => end.mapId === ownerId)
  );
  if (!connections.length) return;
  const ids = new Set(connections.map((connection) => connection.id));
  const openConnections = (scene) => {
    const candidate = copy(scene);
    for (const connection of candidate.connections || []) {
      if (!ids.has(connection.id)) continue;
      connection.enabled = true;
      if (connection.kind === 'door') {
        connection.open = true;
        connection.locked = false;
      }
    }
    return CampaignWorld.fromScene(candidate, context);
  };
  const previous = openConnections(before);
  const next = openConnections(after);
  for (const connection of connections) {
    for (const end of connection.ends) {
      const unit = previous.getMap(end.mapId).grid.tileWorldSize / 5;
      const position = {
        x: end.positionFeet.x * unit,
        y: end.positionFeet.y * unit,
        z: end.positionFeet.z * unit,
      };
      for (const travelMode of ['ground', 'fly']) {
        try {
          previous.planConnection(connection.id, end.mapId, position, { travelMode });
        } catch (error) {
          if (error instanceof ConnectionUnavailableError) continue;
          throw error;
        }
        try {
          next.planConnection(connection.id, end.mapId, position, { travelMode });
        } catch (error) {
          if (!(error instanceof ConnectionUnavailableError)) throw error;
          throw new Error(
            `The "${connection.name}" connection would no longer be usable; preserve its entrance before generating`,
            { cause: error }
          );
        }
      }
    }
  }
}

function validateRetainedLogicalPassages(before, after, context, ownerId) {
  const existing = new Set((before.logicalPassages || []).map((passage) => passage.id));
  const passages = (after.logicalPassages || []).filter(
    (passage) => !existing.has(passage.id) || passage.ends.some((end) => end.mapId === ownerId)
  );
  if (!passages.length) return;
  const previous = CampaignWorld.fromScene(before, context);
  const next = CampaignWorld.fromScene(after, context);
  for (const passage of passages)
    for (const end of passage.ends) {
      if (existing.has(passage.id)) {
        const oldPosition = logicalPassageEndpoint(previous.getMap(end.mapId), end.side).world;
        try {
          previous.planLogicalPassage(passage.id, end.mapId, oldPosition);
        } catch (error) {
          if (error instanceof ConnectionUnavailableError) continue;
          throw error;
        }
      }
      const position = logicalPassageEndpoint(next.getMap(end.mapId), end.side).world;
      try {
        next.planLogicalPassage(passage.id, end.mapId, position);
      } catch (error) {
        if (!(error instanceof ConnectionUnavailableError)) throw error;
        throw new Error('A cavern passage would not have a safe entrance', {
          cause: error,
        });
      }
    }
}

export async function planCampaignBiomeReplacement(gm, options = {}, size = {}) {
  const engine = gm?.terrainEngine;
  const library = gm?.characterServices?.library;
  if (!engine || !library) throw new Error('Open a campaign before generating a replacement map');
  assertBiomeGenerationReady(gm, engine);
  const cols = size.cols ?? engine.cols;
  const rows = size.rows ?? engine.rows;
  if (
    !Number.isInteger(cols) ||
    !Number.isInteger(rows) ||
    cols < GRID_CONFIG.MIN_COLS ||
    cols > GRID_CONFIG.MAX_COLS ||
    rows < GRID_CONFIG.MIN_ROWS ||
    rows > GRID_CONFIG.MAX_ROWS
  )
    throw new RangeError(
      `Grid width and height must each be between ${GRID_CONFIG.MIN_COLS} and ${GRID_CONFIG.MAX_COLS} squares`
    );
  const biomeKey = options.biomeKey ?? engine.biomeKey;
  if (!getBiomeGenerationVariant(biomeKey)) throw new Error('Choose a supported biome variant');
  const captureOptions = {
    completedActionsOnly: true,
    rollLog: gm.sceneAutosave?.getRollLog() || [],
  };
  const before = await captureCampaignScene(gm, library, captureOptions);
  const context = { ruleset: library.ruleset, library };
  const original =
    before.version === 3 ? copy(before) : CampaignWorld.fromScene(before, context).save();
  const ownerId = gm.campaignMapId ?? original.view.mapId;
  const owner = original.maps.find((map) => map.id === ownerId);
  if (!owner) throw new Error('The active map is no longer available');
  const isBuildingArea = !!owner.building;
  const isCavernArea = !!owner.cavern?.parentMapId;
  if (isCavernArea && !CAVERN_BIOME_KEYS.includes(biomeKey))
    throw new Error('A connected cavern area must retain a cavern biome to preserve its passages');
  const network = options.cavernNetwork;
  const logical = (original.logicalPassages || []).some((passage) =>
    passage.ends.some((end) => end.mapId === ownerId)
  );
  if (network !== undefined && !CAVERN_BIOME_KEYS.includes(biomeKey))
    throw new Error('Chamber options require a natural cavern biome');
  if (
    network !== undefined &&
    (!network ||
      !Array.isArray(network.outsideSides) ||
      new Set(network.outsideSides).size !== network.outsideSides.length ||
      network.outsideSides.some((side) => !CAVERN_SIDES.includes(side)))
  )
    throw new Error('Choose valid outside cavern entrances');
  const cavernExits = [
    ...new Set([...occupiedCavernSides(original, ownerId), ...(network?.outsideSides || [])]),
  ];
  const logicalGeneration =
    CAVERN_BIOME_KEYS.includes(biomeKey) && (network !== undefined || logical);
  if (
    logicalGeneration &&
    options.cavernExitCount !== undefined &&
    cavernExits.length > options.cavernExitCount
  )
    throw new Error(
      `The existing and outside links need at least ${cavernExits.length} main entrances`
    );
  if (logicalGeneration) {
    const seed = options.seed ?? engine.biomeSeed;
    const preferred =
      options.cavernExitCount === undefined
        ? defaultCavernExits(biomeKey, seed)
        : cavernExitsForCount(biomeKey, seed, options.cavernExitCount);
    for (const side of preferred)
      if (
        !cavernExits.includes(side) &&
        (options.cavernExitCount === undefined || cavernExits.length < options.cavernExitCount)
      )
        cavernExits.push(side);
  }

  const terrain = engine.planBiomeGeneration(
    biomeKey,
    {
      ...options,
      cavernManualExits: cavernExits,
      ...(isCavernArea ? { cavernKind: owner.terrain.cavern.kind } : {}),
      ...(isCavernArea || logicalGeneration ? { structures: false } : {}),
    },
    { cols, rows, clear: true }
  );
  if (isBuildingArea && terrain.geometry.structures?.some((structure) => structure.building))
    throw new Error('A connected building floor cannot contain another generated building');
  const floorGeometry =
    isBuildingArea && (cols !== owner.grid.cols || rows !== owner.grid.rows)
      ? prepareBuildingFloorGeometry(original, ownerId, { cols, rows })
      : owner.terrain.geometry;
  const retainedVolumes = isBuildingArea
    ? (floorGeometry?.volumes || []).filter((volume) => volume.id.startsWith(`${ownerId}:auto:`))
    : [];
  const geometry = retainedVolumes.length
    ? {
        ...terrain.geometry,
        version: Math.max(
          terrain.geometry.version,
          retainedVolumes.some((volume) => volume.shape) ? 2 : 1
        ),
        volumes: [...retainedVolumes, ...terrain.geometry.volumes],
      }
    : terrain.geometry;
  const hasLinkedConnections = (original.connections || []).some(
    (connection) =>
      connection.feature.mapId === ownerId || connection.ends.some((end) => end.mapId === ownerId)
  );
  const elevationScale = hasLinkedConnections ? engine.elevationScale : terrain.elevationScale;
  const worldElevationUnit =
    elevationScale !== engine.elevationScale && typeof gm.sync3DElevationScaling === 'function'
      ? preview3DElevationUnit(gm, elevationScale)
      : gm.spatial.elevationUnit;
  let isTerrainSupported = null;
  if (isBuildingArea && terrain.placements.length) {
    const feetPerLevel = (worldElevationUnit * 5) / owner.grid.tileWorldSize;
    const floor = new TerrainGeometry({
      widthFeet: cols * 5,
      depthFeet: rows * 5,
      terrainThicknessFeet: 0.5,
      getTerrainHeightFeet: (x, z) =>
        terrain.heights[Math.floor(z / 5)][Math.floor(x / 5)] * feetPerLevel,
    });
    floor.load(geometry);
    const supportedCells = new Map();
    isTerrainSupported = (x, z) => {
      const key = `${x}:${z}`;
      if (supportedCells.has(key)) return supportedCells.get(key);
      const elevation = terrain.heights[z][x] * feetPerLevel;
      const supported = isTerrainCellSupported(floor, x, z, elevation);
      supportedCells.set(key, supported);
      return supported;
    };
    terrain.placements = terrain.placements.filter(({ gridX, gridY }) =>
      isTerrainSupported(gridX, gridY)
    );
  }
  const cache = gm.modelAssetCache;
  const modelAssetCache = cache?.getModel
    ? {
        async getModel(key) {
          const model = await cache.getModel(key);
          if (model) await cache.whenModelReady?.(key);
          return model;
        },
      }
    : cache;
  const scenery = await prepareBiomePlacements(gm, terrain, {
    elevationUnit: worldElevationUnit,
    modelAssetCache,
    isTerrainSupported,
  });
  const specs = terrain.geometry.structures || [];
  if (specs.some((spec) => isVillageExterior(spec) || isDungeonWall(spec))) {
    const construction = await buildConstructionAssets({
      specs,
      three: gm.threeSceneManager?.three,
      worldUnitsPerFoot: gm.spatial.tileWorldSize / 5,
      modelAssetCache,
      strict: true,
    });
    releaseConstructionAssets(construction);
  }
  const current = await captureCampaignScene(gm, library, captureOptions);
  assertBiomeGenerationReady(gm, engine);
  if (
    gm.terrainEngine !== engine ||
    (gm.campaignMapId ?? original.view.mapId) !== ownerId ||
    !sameJsonValue(before, current)
  )
    throw new Error('The active map changed while generation was being prepared');

  const scene = copy(original);
  const map = scene.maps.find((entry) => entry.id === ownerId);
  const oldCavern = map.terrain.cavern;
  map.grid = { ...map.grid, cols, rows };
  map.terrain = {
    ...map.terrain,
    heights: terrain.heights,
    biome: biomeKey,
    seed: terrain.seed,
    elevationScale,
    worldElevationUnit,
    treeDensity: terrain.densityMultiplier,
    generationRecipe: terrain.generationRecipe,
    richShading: { ...map.terrain.richShading, seed: terrain.seed },
    placeables: scenery.placements,
    sightBounds: scenery.sightBounds,
  };
  delete map.terrain.geometry;
  delete map.terrain.cavern;
  delete map.terrain.coverBounds;
  if (geometry.volumes.length) map.terrain.geometry = geometry;
  if (terrain.cavern) map.terrain.cavern = terrain.cavern;
  if (scenery.coverBounds.length) map.terrain.coverBounds = scenery.coverBounds;
  removeMapCreatures(scene, ownerId);

  const buildingContext = captureBuildingContext(original, ownerId);
  if (!isBuildingArea && !isCavernArea && (oldCavern || terrain.cavern)) {
    buildingContext.cavernGeneration = true;
    buildingContext.preserveCavernAreas = true;
    buildingContext.preserveCavernAreaSeeds = true;
    buildingContext.createCavernAreas = !logicalGeneration;
  }
  buildingContext.protectAuthoredCellars = true;
  let assembled = reconcileBuildingScene(scene, context, {
    ownerMapId: ownerId,
    restoreContext: buildingContext,
  });
  const joins = terrain.joins?.length
    ? buildingJoinConnections(assembled, ownerId, terrain.joins)
    : [];
  if (joins.length) {
    const connections = new Map((assembled.connections || []).map((entry) => [entry.id, entry]));
    const topology = ({ kind, feature, ends, pathFeet }) => ({ kind, feature, ends, pathFeet });
    for (const join of joins) {
      const existing = connections.get(join.id);
      if (existing && !sameJsonValue(topology(existing), topology(join)))
        throw new Error(`The "${existing.name}" connection cannot be preserved in the new layout`);
      if (!existing) connections.set(join.id, join);
    }
    assembled.connections = [...connections.values()];
  }
  assertOtherMapsPreserved(original, assembled, ownerId);
  if (network !== undefined)
    assembled = createLogicalCavernNetwork(assembled, {
      mapId: ownerId,
      totalChambers: network.totalChambers,
      outsideSides: network.outsideSides,
      outsideMode: network.outsideMode,
    });
  const replaced = assembled.maps.find((entry) => entry.id === ownerId);
  const camera = assembled.view.camera;
  const { tileWorldSize } = replaced.grid;
  if (
    camera.target.x < 0 ||
    camera.target.z < 0 ||
    camera.target.x >= cols * tileWorldSize ||
    camera.target.z >= rows * tileWorldSize
  ) {
    const x = Math.floor(cols / 2);
    const z = Math.floor(rows / 2);
    camera.target = {
      x: (x + 0.5) * tileWorldSize,
      y: camera.target.y,
      z: (z + 0.5) * tileWorldSize,
    };
  }
  const cameraX = Math.floor(camera.target.x / tileWorldSize);
  const cameraZ = Math.floor(camera.target.z / tileWorldSize);
  camera.target.y =
    replaced.terrain.heights[cameraZ][cameraX] * replaced.terrain.worldElevationUnit;
  const storedCamera = assembled.view.cameras?.find((entry) => entry.mapId === ownerId);
  if (storedCamera) storedCamera.camera = copy(camera);
  for (const other of original.maps) {
    if (
      other.id !== ownerId &&
      mapLocationId(other) === mapLocationId(replaced) &&
      (replaced.cavern || other.cavern) &&
      !cavernAreasOverlap(owner, other) &&
      cavernAreasOverlap(replaced, other)
    )
      throw new Error(`The requested grid would overlap the linked map "${other.name}"`);
  }
  validateScene(assembled, context);
  validateRetainedConnections(original, assembled, context, ownerId);
  validateRetainedLogicalPassages(original, assembled, context, ownerId);
  return { before, scene: assembled, terrain, scenery };
}
