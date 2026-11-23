import { GRID_CONFIG } from '../config/GameConstants.js';
import { getSettlementProfile } from '../config/biome/SettlementProfiles.js';
import { validateConstructionEdit } from './CampaignConstruction.js';
import {
  captureCampaignScene,
  captureReadyCampaignScene,
  reconcileCampaignScene,
  restoreCampaignScene,
} from './SceneWorld.js';
import { assertBiomeGenerationReady, planCampaignBiomeReplacement } from './CampaignBiomePlan.js';
import { encodeScene } from './CampaignScene.js';
import { sameJsonValue } from '../utils/JsonValue.js';
import { manualCavernExits } from './CavernAssembly.js';
import { verifyRejectedSceneSave } from './CampaignSaveOutcome.js';

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

function notifyGenerationState(gm) {
  gm.characterServices?.combat?.syncMovementStatus();
  gm.campaignRequests?.flush();
  if (typeof window !== 'undefined')
    window.dispatchEvent(
      new CustomEvent('taverntable:campaignViewStateChanged', {
        detail: { gameManager: gm },
      })
    );
}

function committedGenerationFailure(cause) {
  return Object.assign(
    new Error(
      'The generated map was saved, but its local view could not finish updating. Reload the campaign.',
      { cause }
    ),
    { committed: true }
  );
}

export async function replaceCampaignBiome(gm, options = {}, size = {}) {
  const library = gm?.characterServices?.library;
  const combat = gm?.characterServices?.combat;
  if (!library?.saveScene || !combat) throw new Error('Open a saved campaign before generating');
  await gm.sceneAutosave?.flush({ waitForScene: false });
  await library.flush?.();
  const engine = gm.terrainEngine;
  const prepared = await planCampaignBiomeReplacement(gm, options, size);
  const captureOptions = {
    completedActionsOnly: true,
    rollLog: gm.sceneAutosave?.getRollLog() || [],
  };
  const current = await captureCampaignScene(gm, library, captureOptions);
  assertBiomeGenerationReady(gm, engine);
  if (gm.terrainEngine !== engine || !sameJsonValue(prepared.before, current))
    throw new Error('The active map changed while generation was being prepared');
  const context = { ruleset: library.ruleset, library };
  const value = encodeScene(prepared.scene, context);
  const previousRevision = library.sceneRevision;
  const previousCharactersRevision = library.revision;
  const previousSavedScene = library.savedScene;
  const history = engine.captureHistory();
  const selectedId = gm.token3DAdapter.getSelectedToken()?.id ?? null;
  let committed = false;
  let saveAttempted = false;
  let failure = null;
  gm.campaignViewBusy = true;
  gm.campaignMapTransition = true;
  try {
    notifyGenerationState(gm);
    await reconcileCampaignScene(gm, prepared.scene, library, combat);
    gm.threeSceneManager.restoreView(prepared.scene.view.camera);
    gm.campaignView?.setCamera(prepared.scene.view.camera);
    saveAttempted = true;
    await library.saveScene(() => ({ scene: prepared.scene, value }));
    committed = true;
    delete gm._settlementDefaultCanvas;
  } catch (error) {
    failure = error instanceof Error ? error : new Error(String(error));
    if (committed) {
      gm.campaignMapFailure = committedGenerationFailure(error);
      failure = gm.campaignMapFailure;
    } else {
      const uncertainSave = saveAttempted
        ? await verifyRejectedSceneSave(library, error, {
            sceneRevision: previousRevision,
            charactersRevision: previousCharactersRevision,
            scene: previousSavedScene,
          })
        : null;
      try {
        await reconcileCampaignScene(gm, prepared.before, library, combat);
        if (gm.terrainEngine !== engine)
          throw new Error('The terrain engine changed during rollback');
        engine.restoreHistory(history);
        const selected = gm.placedTokens.find((token) => token.id === selectedId) || null;
        if (gm.campaignView && selected) gm.campaignView.focus(selected.id);
        await gm.token3DAdapter.setSelectedToken(selected);
        if (gm.campaignView && prepared.before.version === 3)
          gm.campaignView.focus(prepared.before.view.focusTokenId);
        const camera =
          prepared.before.version === 3 ? prepared.before.view.camera : prepared.before.camera;
        gm.stateCoordinator.setViewMode(camera.topDown ? 'topdown' : 'isometric', {
          remember: false,
        });
        gm.threeSceneManager.restoreView(camera);
        gm.campaignView?.setCamera(camera);
        if (typeof window !== 'undefined') {
          const terrain =
            prepared.before.version === 3
              ? prepared.before.maps.find((map) => map.id === prepared.before.view.mapId).terrain
              : prepared.before.terrain;
          window.richShadingSettings = JSON.parse(JSON.stringify(terrain.richShading));
        }
      } catch (rollbackError) {
        gm.campaignMapFailure = new AggregateError(
          [error, rollbackError],
          'The previous map could not be restored. Reload the last saved campaign scene.'
        );
        failure = gm.campaignMapFailure;
      }
      if (!gm.campaignMapFailure && uncertainSave) {
        gm.campaignMapFailure = new AggregateError(
          [error, uncertainSave],
          'The replacement save could not be verified. Reload the campaign before making changes.'
        );
        failure = gm.campaignMapFailure;
      }
    }
  } finally {
    gm.campaignMapTransition = false;
    gm.campaignViewBusy = false;
    try {
      if (!gm.campaignMapFailure)
        gm.sceneAutosave?.changed(committed ? 'biome generation' : 'generation restored');
      notifyGenerationState(gm);
    } catch (notificationError) {
      gm.campaignMapFailure = committed
        ? committedGenerationFailure(notificationError)
        : new AggregateError(
            [gm.campaignMapFailure || failure, notificationError].filter(Boolean),
            'The previous scene could not finish updating. Reload the campaign.'
          );
      failure = gm.campaignMapFailure;
    }
  }
  if (failure) throw failure;
  return true;
}

export async function generateCampaignBiome(gm, options = {}) {
  const engine = gm?.terrainEngine;
  if (!engine) throw new Error('Terrain generation is not ready');
  const biomeKey = options.biomeKey ?? engine.biomeKey;
  const profile = getSettlementProfile(biomeKey);
  const canvasScale = options.canvasScale ?? 1;
  if (!Number.isFinite(canvasScale) || canvasScale < 0.5 || canvasScale > 2)
    throw new Error('Generation canvas scale must be between 0.5 and 2');
  const include = options.structures ?? engine.structureGenerationEnabled;
  const pool = gm.placeableMeshPool;
  const world = gm.campaignWorld;
  if (world?.getMap(gm.campaignMapId).cavern?.parentMapId)
    throw new Error('Return to the main cavern map before regenerating its connected areas');
  options = {
    ...options,
    preserveCavernAreas: true,
    preserveOtherMaps: !!world?.listMaps().some(({ id }) => id !== gm.campaignMapId),
    cavernManualExits: manualCavernExits(
      world?.getConnections(gm.campaignMapId) || [],
      gm.campaignMapId
    ),
  };
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
  const targetCols = profile ? Math.min(100, Math.round((profile.cols * canvasScale) / 5) * 5) : 0;
  const targetRows = profile ? Math.min(100, Math.round((profile.rows * canvasScale) / 5) * 5) : 0;
  const expand = auto && (targetCols > engine.cols || targetRows > engine.rows);
  if (!expand) {
    const result = engine.generateBiomeElevation(biomeKey, options);
    if (auto && result) await rememberDefaultCanvas(gm);
    return result;
  }
  validateConstructionEdit(gm, engine.geometry);
  const library = gm.characterServices?.library;
  const scene = library
    ? captureReadyCampaignScene(gm, library, { completedActionsOnly: true })
    : null;
  try {
    gm.resizeGrid(Math.max(targetCols, engine.cols), Math.max(targetRows, engine.rows), true);
    const result = engine.generateBiomeElevation(biomeKey, options);
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
