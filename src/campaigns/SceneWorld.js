import { normalizeCreatureType } from '../config/CharacterCatalog.js';
import * as TokenMovement from '../entities/creatures/TokenMovement.js';
import { getAutomaticCreatureName } from '../entities/creatures/CreatureNames.js';
import { readStablePlacement, SceneNotReadyError } from '../scene/token-adapter/SavedPlacements.js';
import { readPlaceablePlacements, captureCameraView } from '../scene/SceneSnapshotReaders.js';
import { snapshotCombat } from '../entities/characters/combat/persistence.js';
import { validateScene } from './CampaignScene.js';
import CampaignWorld from './CampaignWorld.js';

export async function captureCampaignScene(
  gameManager,
  library,
  { combat = gameManager.characterServices.combat, change = null, result = null, rollLog = [] } = {}
) {
  const gm = gameManager;
  if (gm.campaignMapFailure) throw gm.campaignMapFailure;
  if (gm.campaignMapTransition)
    throw new SceneNotReadyError('Waiting for the map view to finish changing');
  const pool = gm.placeableMeshPool;
  await Promise.all(gm._pendingInstancingPromises || []);
  await pool?.whenSettled?.();
  if (change?.linkTokenId && !gm.placedTokens.some((token) => token.id === change.linkTokenId)) {
    throw new Error('The creature was removed before its character could be saved');
  }
  const characterIds = new Set(library.list().map((character) => character.id));
  const creatures = gm.placedTokens.map((token) => {
    let characterId = token.characterSheetId || null;
    if (change?.type === 'replace' && characterId === change.oldId) characterId = result;
    if (change?.linkTokenId === token.id) characterId = result;
    if (!characterIds.has(characterId)) characterId = null;
    const character = characterId ? library.get(characterId) : null;
    const movement = TokenMovement.getTokenMovementSettings(token);
    const type = normalizeCreatureType(token.type);
    const automaticName = token.nameMode === 'automatic';
    return {
      id: token.id,
      ...(gm.campaignWorld ? { mapId: token.mapId } : {}),
      type,
      instanceNumber: token.instanceNumber,
      name:
        character?.name ??
        (automaticName
          ? getAutomaticCreatureName(
              type,
              token.instanceNumber,
              gm.tokenManager._tokenTypeCounts?.get(type)
            )
          : token.name),
      nameMode: character ? 'character' : automaticName ? 'automatic' : 'custom',
      characterId,
      allegiance: token.allegiance || 'neutral',
      creatureType: token.creatureType || 'humanoid',
      creatureSize: token.creatureSize || 'medium',
      movement: {
        mode: movement.mode,
        type: movement.type,
        ...(character ? {} : { speed: movement.speed }),
      },
      ...(character || !token.fallTraits
        ? {}
        : { fallTraits: TokenMovement.getTokenFallTraits(token) }),
      ...readStablePlacement(gm.token3DAdapter, token),
    };
  });
  const links = new Map(creatures.map((creature) => [creature.id, creature.characterId]));
  const savedCombat = snapshotCombat(combat, {
    movementCosts: gm.token3DAdapter.getCheckpointMovementCosts?.(),
    movementSession: gm.characterServices?.combat || combat,
  });
  savedCombat.histories = savedCombat.histories.filter((group) =>
    characterIds.has(group.characterId)
  );
  savedCombat.states = savedCombat.states.filter(
    (row) => row.characterId === links.get(row.tokenId)
  );
  savedCombat.effects = (savedCombat.effects || [])
    .filter(
      (effect) =>
        characterIds.has(effect.characterId) &&
        (!(effect.followCaster || effect.kind === 'flight') || links.has(effect.casterTokenId)) &&
        (effect.kind !== 'flight' || links.get(effect.casterTokenId) === effect.characterId) &&
        (!effect.concentrationSpellId ||
          library.get(effect.characterId).concentration === effect.concentrationSpellId)
    )
    .flatMap((effect) => {
      if (effect.kind !== 'flight') return [effect];
      const targetTokenIds = effect.targetTokenIds.filter((tokenId) => links.has(tokenId));
      return targetTokenIds.length ? [{ ...effect, targetTokenIds }] : [];
    });
  if (!savedCombat.states.some((row) => row.tokenId === savedCombat.activeTokenId))
    savedCombat.activeTokenId = null;
  const terrainState = gm.terrainEngine.save();
  const placeables = pool ? readPlaceablePlacements(pool) : [];
  const structureCover = placeables.some((entry) => ['structure', 'building'].includes(entry.type))
    ? pool.targetingCoverBounds()
    : [];
  const scene = {
    version: terrainState.geometry ? 2 : 1,
    ruleset: library.ruleset,
    grid: { cols: gm.cols, rows: gm.rows, tileWorldSize: gm.spatial.tileWorldSize },
    terrain: {
      heights: terrainState.heights,
      ...(terrainState.geometry ? { geometry: terrainState.geometry } : {}),
      biome: terrainState.biomeKey,
      seed: terrainState.biomeSeed,
      elevationScale: terrainState.elevationScale,
      worldElevationUnit: gm.spatial.elevationUnit,
      treeDensity: terrainState.treeDensityMultiplier,
      richShading: JSON.parse(JSON.stringify(globalThis.window?.richShadingSettings || {})),
      placeables,
      ...(structureCover.length ? { coverBounds: structureCover } : {}),
    },
    creatures,
    tokenCounters: {
      nextId: gm.tokenManager._nextTokenId || 0,
      types: [...(gm.tokenManager._tokenTypeCounts || new Map())],
    },
    camera: gm.threeSceneManager.snapshotView?.() || captureCameraView(gm.threeSceneManager),
    combat: savedCombat,
    selection: gm.token3DAdapter.getSelectedToken()?.id ?? null,
    rollLog: JSON.parse(JSON.stringify(rollLog)),
  };
  if (gm.campaignWorld) {
    const saved = gm.campaignWorld.save();
    const map = saved.maps.find((entry) => entry.id === gm.campaignMapId);
    if (!map) throw new Error('The displayed campaign map does not exist');
    map.grid = scene.grid;
    map.terrain = scene.terrain;
    saved.creatures = creatures;
    saved.tokenCounters = scene.tokenCounters;
    saved.combat = savedCombat;
    saved.rollLog = scene.rollLog;
    saved.view = gm.campaignView.snapshot(scene.camera);
    return validateScene(saved, { ruleset: library.ruleset, library });
  }
  return validateScene(scene, { ruleset: library.ruleset, library });
}

export function applySceneCharacterLinks(gameManager, scene, library) {
  const saved = new Map(scene.creatures.map((creature) => [creature.id, creature]));
  const changed = [];
  for (const token of gameManager.placedTokens) {
    const creature = saved.get(token.id);
    if (!creature) continue;
    const previousId = token.characterSheetId || null;
    if (
      previousId !== creature.characterId ||
      token.name !== creature.name ||
      token.nameMode !== creature.nameMode
    ) {
      if (creature.characterId)
        TokenMovement.linkTokenCharacter(token, library, creature.characterId);
      else {
        TokenMovement.unlinkTokenCharacter(token, creature.movement);
        token.name = creature.name;
        token.nameMode = creature.nameMode;
      }
      changed.push(token);
    }
    if (previousId !== creature.characterId)
      gameManager.characterServices.combat.forget(token, {
        preserveTargetEffects: previousId === null && creature.characterId !== null,
      });
  }
  const ids = new Set(library.list().map((character) => character.id));
  for (const id of gameManager.characterServices.combat.histories.keys()) {
    if (!ids.has(id)) gameManager.characterServices.combat.histories.delete(id);
  }
  gameManager.characterServices.combat.syncEffects();
  return changed;
}

export async function restoreCampaignScene(gameManager, scene, library, combat) {
  validateScene(scene, { ruleset: library.ruleset, library });
  const gm = gameManager;
  const world =
    scene.version === 3
      ? CampaignWorld.fromScene(scene, { ruleset: library.ruleset, library })
      : null;
  const map = world ? world.getMap(scene.view.mapId) : scene;
  for (const token of [...gm.placedTokens]) gm.tokenManager.removeToken(token);
  gm.campaignWorld = world;
  gm.campaignMapId = world ? scene.view.mapId : null;
  gm.campaignView = world
    ? world.createView({ mapId: scene.view.mapId, focusTokenId: scene.view.focusTokenId })
    : null;
  await applyMapTerrain(gm, map);
  const restored = [];
  for (const creature of scene.creatures) {
    const model = gm.tokenManager.createCreatureByType(creature.type);
    if (!model) throw new Error(`The saved creature model "${creature.type}" could not be created`);
    gm.tokenManager.addTokenToCollection(
      model,
      creature.gridX,
      creature.gridY,
      creature.type,
      null,
      creature
    );
    const token = gm.placedTokens.at(-1);
    if (!token || token.creature !== model) throw new Error('A saved creature could not be placed');
    token.id = creature.id;
    token.instanceNumber = creature.instanceNumber;
    token.movementSettings = { ...creature.movement };
    token.allegiance = creature.allegiance || 'neutral';
    token.creatureType = creature.creatureType || 'humanoid';
    token.creatureSize = creature.creatureSize || 'medium';
    if (creature.fallTraits) token.fallTraits = { ...creature.fallTraits };
    if (creature.characterId)
      TokenMovement.linkTokenCharacter(token, library, creature.characterId);
    restored.push({ token, creature });
  }
  const typeCounts = new Map(scene.tokenCounters.types);
  for (const { token, creature } of restored) {
    token.name =
      creature.nameMode === 'automatic'
        ? getAutomaticCreatureName(
            creature.type,
            creature.instanceNumber,
            typeCounts.get(creature.type)
          )
        : creature.name;
    token.nameMode = creature.nameMode;
    await gm.token3DAdapter.restoreStablePlacement(token, creature);
  }
  gm.tokenManager._nextTokenId = scene.tokenCounters.nextId;
  gm.tokenManager._tokenTypeCounts = typeCounts;
  combat.restore(scene.combat, gm.placedTokens);
  const selection = world ? scene.view.focusTokenId : scene.selection;
  const camera = world ? scene.view.camera : scene.camera;
  gm.token3DAdapter.setSelectedToken(
    gm.placedTokens.find((token) => token.id === selection) || null
  );
  gm.stateCoordinator.setViewMode(camera.topDown ? 'topdown' : 'isometric', {
    remember: false,
  });
  gm.threeSceneManager.restoreView(camera);
  if (world) await gm.token3DAdapter.syncMapProjections();
}

async function applyMapTerrain(gm, map) {
  const terrain = map.terrain;
  gm.spatial.tileWorldSize = map.grid.tileWorldSize;
  gm.spatial.elevationUnit = terrain.worldElevationUnit;
  gm.resizeGrid(map.grid.cols, map.grid.rows);
  if (globalThis.window) {
    window.selectedBiome = terrain.biome;
    window.richShadingSettings = JSON.parse(JSON.stringify(terrain.richShading));
  }
  gm.terrainEngine.configureGeometryBase(map.base === 'floor' ? 0.5 : null);
  gm.terrainEngine.configureGeometryScale(
    (terrain.worldElevationUnit * 5) / map.grid.tileWorldSize
  );
  gm.terrainEngine.load({
    heights: terrain.heights,
    biomeKey: terrain.biome,
    biomeSeed: terrain.seed,
    elevationScale: terrain.elevationScale,
    treeDensityMultiplier: terrain.treeDensity,
    richShadingEnabled: terrain.richShading.enabled === true,
    ...(terrain.geometry ? { geometry: terrain.geometry } : {}),
  });
  gm.notifyTerrainHeightsChanged();
  const pool = gm.ensureInstancing();
  if (!pool && terrain.placeables.length)
    throw new Error('The saved terrain placement renderer is unavailable');
  if (pool) await pool.restorePlacements(terrain.placeables);
}

async function restoreMapVisuals(gm, checkpoint, mapId) {
  const map = gm.campaignWorld.getMap(mapId);
  gm.token3DAdapter.clearMapProjectionTerrain?.();
  gm.token3DAdapter.disposeTacticalTokens?.();
  for (const token of gm.placedTokens) {
    if (token.__threeMesh) token.__threeMesh.visible = false;
  }
  await Promise.all(gm.placedTokens.map((token) => token.__threeMeshPromise));
  if (map.grid.tileWorldSize !== gm.spatial.tileWorldSize)
    for (const token of gm.placedTokens) gm.token3DAdapter.releaseTokenVisual(token);
  await applyMapTerrain(gm, map);
  const placements = new Map(checkpoint.creatures.map((creature) => [creature.id, creature]));
  for (const token of gm.placedTokens) {
    if (token.mapId !== mapId) continue;
    const placement = placements.get(token.id);
    await gm.token3DAdapter.onTokenAdded(token, placement);
    await gm.token3DAdapter.restoreStablePlacement(token, placement);
  }
  for (const token of gm.placedTokens) if (token.mapId === mapId) token.__threeMesh.visible = true;
}

function notifyCampaignViewState(gm) {
  // Publish readiness here because view changes pause the normal animation ticks.
  gm.characterServices.combat.syncMovementStatus();
  if (typeof window !== 'undefined')
    window.dispatchEvent(
      new CustomEvent('taverntable:campaignViewStateChanged', { detail: { gameManager: gm } })
    );
}

export async function changeCampaignView(gm, { mapId = null, focusTokenId = null } = {}) {
  if (!gm.campaignWorld || !gm.campaignView)
    throw new Error('This campaign does not have connected maps');
  if (gm.campaignMapFailure) throw gm.campaignMapFailure;
  if (gm.campaignViewBusy) throw new Error('Wait for the current map change to finish');
  const combat = gm.characterServices.combat;
  if (
    gm.sceneAutosave?.ready === false ||
    gm.characterServices.library.isSaving ||
    combat.pending ||
    combat.committing ||
    combat.moves.size ||
    gm.terrainEngine.hasPendingStroke ||
    gm.placedTokens.some((token) => gm.token3DAdapter.isMovementInProgress(token))
  )
    throw new Error('Finish the current movement, action or terrain preview before changing maps');
  const focused =
    focusTokenId === null ? null : gm.placedTokens.find((token) => token.id === focusTokenId);
  if (focusTokenId !== null && !focused) throw new Error('The focused creature no longer exists');
  const targetId = focused?.mapId || mapId || gm.campaignMapId;
  if (mapId !== null && focused && mapId !== focused.mapId)
    throw new Error('The focused creature belongs to another map');
  gm.campaignWorld.getMap(targetId);
  const changingMap = targetId !== gm.campaignMapId;
  const selectedBefore = gm.token3DAdapter.getSelectedToken();
  let before = null;
  gm.campaignViewBusy = true;
  try {
    notifyCampaignViewState(gm);
    await gm.sceneAutosave?.flush();
    before = await captureCampaignScene(gm, gm.characterServices.library, {
      rollLog: gm.sceneAutosave ? gm.sceneAutosave.getRollLog() : gm.campaignWorld.save().rollLog,
    });
    gm.campaignWorld.acceptCheckpoint(before);
    gm.campaignView.setCamera(before.view.camera);
    gm.campaignMapTransition = true;
    if (changingMap) {
      gm.token3DAdapter.setHoverToken(null);
      gm.token3DAdapter.refreshMovementRange();
    }
    gm.campaignView.showMap(targetId);
    if (focused) gm.campaignView.focus(focused.id);
    gm.campaignMapId = targetId;
    if (changingMap) {
      await restoreMapVisuals(gm, before, targetId);
    }
    const camera = gm.campaignView.camera;
    if (!gm.campaignView.hasCamera) camera.zoom = 1;
    if (focused) camera.target = { ...focused.world };
    else if (!gm.campaignView.hasCamera)
      camera.target = {
        x: (gm.cols * gm.spatial.tileWorldSize) / 2,
        y: 0,
        z: (gm.rows * gm.spatial.tileWorldSize) / 2,
      };
    gm.stateCoordinator.setViewMode(camera.topDown ? 'topdown' : 'isometric', {
      remember: false,
    });
    gm.threeSceneManager.restoreView(camera);
    gm.campaignMapTransition = false;
    await gm.token3DAdapter.setSelectedToken(focused);
    await gm.token3DAdapter.syncMapProjections();
    gm.sceneAutosave?.changed('map view');
    await gm.sceneAutosave?.flush();
  } catch (error) {
    if (before) {
      try {
        gm.campaignMapTransition = true;
        gm.campaignWorld.acceptCheckpoint(before);
        gm.campaignView.showMap(before.view.mapId);
        if (before.view.focusTokenId) gm.campaignView.focus(before.view.focusTokenId);
        gm.campaignMapId = before.view.mapId;
        if (changingMap) await restoreMapVisuals(gm, before, before.view.mapId);
        gm.stateCoordinator.setViewMode(before.view.camera.topDown ? 'topdown' : 'isometric', {
          remember: false,
        });
        gm.threeSceneManager.restoreView(before.view.camera);
        gm.campaignMapTransition = false;
        await gm.token3DAdapter.setSelectedToken(selectedBefore);
      } catch (restoreError) {
        gm.campaignMapFailure = new AggregateError(
          [error, restoreError],
          'The map view could not be restored. Reload this page to reopen the last saved campaign.'
        );
        throw gm.campaignMapFailure;
      }
    }
    throw error;
  } finally {
    gm.campaignMapTransition = false;
    gm.campaignViewBusy = false;
    notifyCampaignViewState(gm);
    gm.token3DAdapter.refreshMovementRange();
  }
}
