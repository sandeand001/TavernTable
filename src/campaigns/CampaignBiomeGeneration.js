import { GRID_CONFIG } from '../config/GameConstants.js';
import { getSettlementProfile } from '../config/biome/SettlementProfiles.js';
import { validateConstructionEdit } from './CampaignConstruction.js';
import { captureReadyCampaignScene, restoreCampaignScene } from './SceneWorld.js';

function generationSignature(gm) {
  return JSON.stringify({
    geometry: gm.terrainEngine.geometry.save(),
    heights: gm.terrainEngine.save().heights,
    floors:
      gm.campaignWorld
        ?.listLocationMaps(gm.campaignMapId)
        .map((entry) => gm.campaignWorld.getMap(entry.id))
        .filter((map) => map.building)
        .map((map) => ({ id: map.id, name: map.name, terrain: map.terrain })) ?? [],
    plants: gm.placeableMeshPool?.getStats().instances ?? 0,
  });
}

async function rememberDefaultCanvas(gm) {
  await gm.placeableMeshPool?.whenSettled?.();
  gm._settlementDefaultCanvas = {
    cols: gm.terrainEngine.cols,
    rows: gm.terrainEngine.rows,
    mapId: gm.campaignMapId ?? null,
    signature: generationSignature(gm),
  };
}

export async function generateCampaignBiome(gm, options = {}) {
  const engine = gm?.terrainEngine;
  if (!engine) throw new Error('Terrain generation is not ready');
  const profile = getSettlementProfile(engine.biomeKey);
  const include = options.structures ?? engine.structureGenerationEnabled;
  const pool = gm.placeableMeshPool;
  const world = gm.campaignWorld;
  const hasLocalActors = (gm.placedTokens || []).some(
    (token) => !world || world.sharesLocation(token.mapId, gm.campaignMapId)
  );
  const marker = gm._settlementDefaultCanvas;
  const managedDefault =
    marker &&
    marker.cols === engine.cols &&
    marker.rows === engine.rows &&
    marker.mapId === (gm.campaignMapId ?? null) &&
    marker.signature === generationSignature(gm);
  const safe =
    profile &&
    include &&
    typeof gm.resizeGrid === 'function' &&
    Array.isArray(gm.placedTokens) &&
    !hasLocalActors &&
    !engine.canUndo &&
    !engine.canRedo &&
    (!world || !world.getMap(gm.campaignMapId).building);
  const emptyDefault =
    profile &&
    include &&
    typeof gm.resizeGrid === 'function' &&
    engine.cols === GRID_CONFIG.DEFAULT_COLS &&
    engine.rows === GRID_CONFIG.DEFAULT_ROWS &&
    Array.isArray(gm.placedTokens) &&
    !hasLocalActors &&
    !engine.geometry.hasVolumes &&
    !engine.canUndo &&
    !engine.canRedo &&
    (!pool || (typeof pool.getStats === 'function' && pool.getStats().instances === 0)) &&
    (!world ||
      (world.listLocationMaps(gm.campaignMapId).length === 1 &&
        !world.getMap(gm.campaignMapId).building &&
        world
          .getConnections()
          .filter((connection) => world.sharesLocation(connection.ends[0].mapId, gm.campaignMapId))
          .length === 0));
  const before = safe && (emptyDefault || managedDefault) ? engine.save() : null;
  const auto = before && before.heights.every((row) => row.every((height) => height === 0));
  const expand = auto && (profile.cols > engine.cols || profile.rows > engine.rows);
  if (!expand) {
    const result = engine.generateBiomeElevation(engine.biomeKey, options);
    if (auto && result) await rememberDefaultCanvas(gm);
    return result;
  }
  validateConstructionEdit(gm, engine.geometry);
  const library = gm.characterServices?.library;
  const scene = library
    ? captureReadyCampaignScene(gm, library, { completedActionsOnly: true })
    : null;
  try {
    gm.resizeGrid(Math.max(profile.cols, engine.cols), Math.max(profile.rows, engine.rows), true);
    const result = engine.generateBiomeElevation(engine.biomeKey, options);
    if (!result) throw new Error('Terrain generation could not begin');
    await rememberDefaultCanvas(gm);
    return result;
  } catch (error) {
    if (scene) await restoreCampaignScene(gm, scene, library, gm.characterServices.combat);
    else {
      gm.resizeGrid(before.heights[0].length, before.heights.length, true);
      engine.load(before);
    }
    throw error;
  }
}
