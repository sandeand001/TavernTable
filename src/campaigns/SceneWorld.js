import { normalizeCreatureType } from '../config/CharacterCatalog.js';
import * as TokenMovement from '../entities/creatures/TokenMovement.js';
import { getAutomaticCreatureName } from '../entities/creatures/CreatureNames.js';
import { readStablePlacement, SceneNotReadyError } from '../scene/token-adapter/SavedPlacements.js';
import { readPlaceablePlacements, captureCameraView } from '../scene/SceneSnapshotReaders.js';
import { snapshotCombat } from '../entities/characters/combat/persistence.js';
import { validateScene } from './CampaignScene.js';
import CampaignWorld from './CampaignWorld.js';
import { prepareConnectionTravel } from './CampaignTravel.js';
import { reconcileBuildingScene } from './BuildingAssembly.js';

export function isCampaignActionInProgress(gameManager, { allowMovementCheckpoint = false } = {}) {
  const combat = gameManager.characterServices?.combat;
  return !!(
    gameManager.campaignMapTransition ||
    combat?.pending ||
    combat?.committing ||
    (!allowMovementCheckpoint &&
      gameManager.placedTokens.some((token) =>
        gameManager.token3DAdapter.isMovementInProgress(token)
      ))
  );
}

export async function captureCampaignScene(gameManager, library, options = {}) {
  if (gameManager.campaignMapFailure) throw gameManager.campaignMapFailure;
  await Promise.all(gameManager._pendingInstancingPromises || []);
  await gameManager.placeableMeshPool?.whenSettled?.();
  return captureReadyCampaignScene(gameManager, library, options);
}

export function captureReadyCampaignScene(
  gameManager,
  library,
  {
    combat = gameManager.characterServices.combat,
    change = null,
    result = null,
    rollLog = [],
    placements = combat.scenePlacements || null,
    completedActionsOnly = false,
    geometryOverride = undefined,
    buildingContext = null,
  } = {}
) {
  const gm = gameManager;
  if (gm.campaignMapFailure) throw gm.campaignMapFailure;
  if (gm.campaignMapTransition && !placements?.size)
    throw new SceneNotReadyError('Waiting for the map view to finish changing');
  const pool = gm.placeableMeshPool;
  if (completedActionsOnly && isCampaignActionInProgress(gm))
    throw new SceneNotReadyError('Waiting for the current action to finish...');
  if (change?.linkTokenId && !gm.placedTokens.some((token) => token.id === change.linkTokenId)) {
    throw new Error('The creature was removed before its character could be saved');
  }
  const characterIds = new Set(library.list().map((character) => character.id));
  const creatures = gm.placedTokens.map((token) => {
    const staged = placements?.get(token.id);
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
      ...(gm.campaignWorld ? { mapId: staged ? staged.mapId : token.mapId } : {}),
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
      ...(staged ? staged.placement : readStablePlacement(gm.token3DAdapter, token)),
    };
  });
  const links = new Map(creatures.map((creature) => [creature.id, creature.characterId]));
  const movementCosts = gm.token3DAdapter.getCheckpointMovementCosts?.() || new Map();
  const travel = gm.campaignTravel;
  if (travel?.arrived && travel.ticket) movementCosts.set(travel.token.id, travel.cost);
  const savedCombat = snapshotCombat(combat, {
    movementCosts,
    movementSession: gm.characterServices?.combat || combat,
  });
  if (travel?.arrived && travel.free && travel.cost > 0) {
    const state = savedCombat.states.find((entry) => entry.tokenId === travel.token.id);
    if (state) state.movementSpent = 0;
  }
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
        (!effect.movement ||
          library
            .get(effect.characterId)
            .spells.some(
              (spell) => spell.id === effect.sourceSpellId && spell.entryId === effect.sourceId
            )) &&
        (!(effect.followCaster || effect.kind === 'flight' || effect.movement) ||
          links.has(effect.casterTokenId)) &&
        (!(effect.kind === 'flight' || effect.movement) ||
          links.get(effect.casterTokenId) === effect.characterId) &&
        (!effect.concentrationSpellId ||
          library.get(effect.characterId).concentration === effect.concentrationSpellId)
    )
    .flatMap((effect) => {
      if (!['flight', 'targets'].includes(effect.kind)) return [effect];
      const targetTokenIds = effect.targetTokenIds.filter((tokenId) => links.has(tokenId));
      return targetTokenIds.length ? [{ ...effect, targetTokenIds }] : [];
    });
  if (!savedCombat.states.some((row) => row.tokenId === savedCombat.activeTokenId))
    savedCombat.activeTokenId = null;
  const terrainState = gm.terrainEngine.save();
  if (geometryOverride !== undefined) {
    if (geometryOverride.volumes.length) terrainState.geometry = geometryOverride;
    else delete terrainState.geometry;
  }
  const placeables = pool ? readPlaceablePlacements(pool) : [];
  const sightBounds = pool?.sightBlockingBounds?.() || [];
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
      ...(terrainState.structureGenerationEnabled === false
        ? { structureGenerationEnabled: false }
        : {}),
      biome: terrainState.biomeKey,
      seed: terrainState.biomeSeed,
      elevationScale: terrainState.elevationScale,
      worldElevationUnit: gm.spatial.elevationUnit,
      treeDensity: terrainState.treeDensityMultiplier,
      richShading: JSON.parse(JSON.stringify(globalThis.window?.richShadingSettings || {})),
      placeables,
      sightBounds,
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
    const followedId = placements?.has(saved.view.focusTokenId)
      ? saved.view.focusTokenId
      : scene.selection;
    const landing = placements?.get(followedId);
    if (landing) {
      const previous = saved.view.cameras?.find((entry) => entry.mapId === landing.mapId)?.camera;
      const camera = JSON.parse(JSON.stringify(previous || saved.view.camera));
      camera.target = { ...landing.placement.pose.world };
      if (!previous) camera.zoom = 1;
      const cameras = new Map(
        (saved.view.cameras || []).map((entry) => [entry.mapId, entry.camera])
      );
      cameras.set(landing.mapId, camera);
      saved.view.focusTokenId = followedId;
      saved.view.mapId = landing.mapId;
      saved.view.camera = camera;
      saved.view.cameras = [...cameras].map(([mapId, value]) => ({ mapId, camera: value }));
    }
    const context = { ruleset: library.ruleset, library };
    return validateScene(
      reconcileBuildingScene(saved, context, {
        ownerMapId: gm.campaignMapId,
        restoreContext: buildingContext,
      }),
      context
    );
  }
  const context = { ruleset: library.ruleset, library };
  return validateScene(
    reconcileBuildingScene(scene, context, {
      ownerMapId: 'map-main',
      restoreContext: buildingContext,
    }),
    context
  );
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

export async function reconcileCampaignScene(gm, scene, library, combat) {
  validateScene(scene, { ruleset: library.ruleset, library });
  const camera = gm.threeSceneManager.snapshotView();
  const selectedId = gm.token3DAdapter.getSelectedToken()?.id || null;
  const focusId = gm.campaignView?.focusTokenId || selectedId;
  const previousMapId = gm.campaignMapId;
  const previousMap = gm.campaignWorld?.getMap(previousMapId);
  const world =
    scene.version === 3
      ? CampaignWorld.fromScene(scene, { ruleset: library.ruleset, library })
      : null;
  const mapId = world ? previousMapId || scene.view.mapId : null;
  const map = world ? world.getMap(mapId) : scene;
  const assetsChanged = !previousMap || JSON.stringify(previousMap) !== JSON.stringify(map);
  const ids = new Set(scene.creatures.map(({ id }) => id));
  for (const token of [...gm.placedTokens])
    if (!ids.has(token.id)) gm.tokenManager.removeToken(token);
  gm.campaignWorld = world;
  gm.campaignMapId = mapId;
  gm.campaignView = world
    ? world.createView({
        mapId,
        focusTokenId: ids.has(focusId) ? focusId : null,
      })
    : null;
  if (assetsChanged) await applyMapTerrain(gm, map);
  const typeCounts = new Map(scene.tokenCounters.types);
  for (const creature of scene.creatures) {
    let token = gm.placedTokens.find(({ id }) => id === creature.id);
    if (!token) {
      const model = gm.tokenManager.createCreatureByType(creature.type);
      gm.tokenManager.addTokenToCollection(
        model,
        creature.gridX,
        creature.gridY,
        creature.type,
        null,
        creature
      );
      token = gm.placedTokens.at(-1);
      if (!token || token.creature !== model)
        throw new Error('A shared creature could not be placed');
    } else if (token.type !== creature.type) {
      gm.token3DAdapter.onTokenRemoved(token);
      token.creature = gm.tokenManager.createCreatureByType(creature.type);
    }
    Object.assign(token, {
      id: creature.id,
      instanceNumber: creature.instanceNumber,
      type: creature.type,
      mapId: creature.mapId,
      name:
        creature.nameMode === 'automatic'
          ? getAutomaticCreatureName(
              creature.type,
              creature.instanceNumber,
              typeCounts.get(creature.type)
            )
          : creature.name,
      nameMode: creature.nameMode,
      gridX: creature.gridX,
      gridY: creature.gridY,
      world: { ...creature.pose.world },
      facingAngle: creature.facingAngle,
      movementSettings: { ...creature.movement },
      allegiance: creature.allegiance || 'neutral',
      creatureType: creature.creatureType || 'humanoid',
      creatureSize: creature.creatureSize || 'medium',
      fallTraits: creature.fallTraits ? { ...creature.fallTraits } : undefined,
    });
    if (creature.characterId)
      TokenMovement.linkTokenCharacter(token, library, creature.characterId);
    else TokenMovement.unlinkTokenCharacter(token, creature.movement);
    await gm.token3DAdapter.onTokenAdded(token, creature);
    await gm.token3DAdapter.restoreStablePlacement(token, creature);
  }
  gm.tokenManager._nextTokenId = scene.tokenCounters.nextId;
  gm.tokenManager._tokenTypeCounts = typeCounts;
  combat.restore(scene.combat, gm.placedTokens);
  await gm.token3DAdapter.setSelectedToken(
    gm.placedTokens.find(({ id }) => id === selectedId) || null
  );
  gm.stateCoordinator.setViewMode(camera.topDown ? 'topdown' : 'isometric', { remember: false });
  gm.threeSceneManager.restoreView(camera);
  gm.campaignView?.setCamera(camera);
  if (world) await gm.token3DAdapter.syncMapProjections();
}

export async function applyMapTerrain(gm, map) {
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
    ...(terrain.structureGenerationEnabled === false ? { structureGenerationEnabled: false } : {}),
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

function viewFollowsCreature(gm, token, selected) {
  return gm.campaignView.focusTokenId === token.id || selected === token;
}

function settleOtherCampaignMovement(gm, token) {
  const moving = () =>
    gm.placedTokens.some(
      (actor) => actor !== token && gm.token3DAdapter.isMovementInProgress(actor)
    );
  if (!moving()) return Promise.resolve();
  return new Promise((resolve) => {
    const frame = () => {
      if (moving()) return;
      gm.threeSceneManager.removeAnimationCallback(frame);
      resolve();
    };
    gm.threeSceneManager.addAnimationCallback(frame);
  });
}

export async function finishCampaignPhysicalLanding(gm, token, landing) {
  const selected = gm.token3DAdapter.getSelectedToken();
  const follows = viewFollowsCreature(gm, token, selected);
  gm.campaignViewBusy = true;
  gm.campaignMapTransition = true;
  gm.campaignFallSettling = true;
  try {
    notifyCampaignViewState(gm);
    await settleOtherCampaignMovement(gm, token);
    gm.campaignFallSettling = false;
    const scene = await captureCampaignScene(gm, gm.characterServices.library, {
      placements: new Map([[token.id, landing]]),
      rollLog: gm.sceneAutosave?.getRollLog() || gm.campaignWorld.save().rollLog,
    });
    gm.campaignView.setCamera(gm.threeSceneManager.snapshotView());
    gm.campaignWorld.acceptCheckpoint(scene);
    token.mapId = landing.mapId;
    token.gridX = landing.placement.gridX;
    token.gridY = landing.placement.gridY;
    token.facingAngle = landing.placement.facingAngle;
    token.world = { ...landing.placement.pose.world };
    delete token.flightActive;
    delete token.openingHold;
    if (follows) {
      gm.campaignView.showMap(landing.mapId);
      gm.campaignView.focus(token.id);
      gm.campaignMapId = landing.mapId;
      await restoreMapVisuals(gm, scene, landing.mapId);
      gm.campaignView.setCamera(scene.view.camera);
      gm.stateCoordinator.setViewMode(scene.view.camera.topDown ? 'topdown' : 'isometric', {
        remember: false,
      });
      gm.threeSceneManager.restoreView(scene.view.camera);
    } else {
      gm.token3DAdapter.releaseTokenVisual(token);
      await gm.token3DAdapter.restoreStablePlacement(token, landing.placement);
    }
    gm.campaignMapTransition = false;
    await gm.token3DAdapter.setSelectedToken(
      follows ? token : selected?.mapId === gm.campaignMapId ? selected : null
    );
    await gm.token3DAdapter.syncMapProjections();
    gm.sceneAutosave?.changed('physical fall landing');
    await gm.sceneAutosave?.flush();
  } catch (error) {
    gm.campaignMapFailure = new AggregateError(
      [error],
      'The landing was committed, but its view could not finish. Reload to reopen the saved landing.'
    );
    throw gm.campaignMapFailure;
  } finally {
    gm.campaignFallSettling = false;
    gm.campaignMapTransition = false;
    gm.campaignViewBusy = false;
    notifyCampaignViewState(gm);
    gm.token3DAdapter.refreshMovementRange();
  }
}

export async function travelCampaignConnection(gm, token, connectionId, options = {}) {
  const plan = prepareConnectionTravel(gm, token, connectionId, options);
  if (plan.fall) {
    gm.token3DAdapter.releaseOpeningHold(token);
    return { connectionId, mapId: token.mapId, costFeet: 0, fallStarted: true };
  }
  if (
    plan.kind === 'window' &&
    plan.targetMapId === token.mapId &&
    ['ledge', 'grip'].includes(plan.targetPose?.kind) &&
    options.action !== 'down'
  ) {
    const movement = gm.token3DAdapter.requestClimbTowardOpening(
      token,
      connectionId,
      plan.targetPose
    );
    if (!movement) throw new Error('The physical approach to this window could not start');
    return { connectionId, mapId: token.mapId, costFeet: movement.cost, movementStarted: true };
  }
  const session = gm.characterServices.combat;
  const ticket = token.characterSheetId
    ? session.beginConnectionMovement(token, plan.costFeet, plan.travelMode)
    : null;
  const selected = gm.token3DAdapter.getSelectedToken();
  const follows = viewFollowsCreature(gm, token, selected);
  const changesMap = follows && plan.targetMapId !== gm.campaignMapId;
  let before = null;
  let committed = false;
  gm.campaignViewBusy = true;
  gm.campaignTravel = { token, ticket, cost: plan.costFeet, free: plan.free, arrived: false };
  try {
    notifyCampaignViewState(gm);
    await gm.sceneAutosave?.flush();
    before = await captureCampaignScene(gm, gm.characterServices.library, {
      rollLog: gm.sceneAutosave?.getRollLog() || gm.campaignWorld.save().rollLog,
    });
    gm.campaignWorld.acceptCheckpoint(before);
    gm.campaignView.setCamera(before.view.camera);
    const next = gm.campaignWorld.save();
    const moved = next.creatures.find((actor) => actor.id === token.id);
    const target = gm.campaignWorld.getMap(plan.targetMapId);
    moved.mapId = plan.targetMapId;
    moved.pose = { ...(plan.targetPose || { kind: 'ground' }), world: { ...plan.targetWorld } };
    moved.gridX = Math.floor(plan.targetWorld.x / target.grid.tileWorldSize);
    moved.gridY = Math.floor(plan.targetWorld.z / target.grid.tileWorldSize);
    moved.facingAngle = plan.targetFacingAngle ?? moved.facingAngle + plan.facingDelta;
    if (follows) {
      next.view.mapId = plan.targetMapId;
      next.view.focusTokenId = token.id;
    }
    gm.campaignMapTransition = true;
    gm.campaignWorld.acceptCheckpoint(next);
    token.mapId = moved.mapId;
    token.gridX = moved.gridX;
    token.gridY = moved.gridY;
    token.world = { ...moved.pose.world };
    token.facingAngle = moved.facingAngle;
    if (moved.pose.kind === 'flight') token.flightActive = true;
    else delete token.flightActive;
    if (changesMap) {
      gm.campaignView.showMap(moved.mapId);
      gm.campaignView.focus(token.id);
      gm.campaignMapId = moved.mapId;
      await restoreMapVisuals(gm, next, moved.mapId);
      const camera = gm.campaignView.camera;
      if (!gm.campaignView.hasCamera) camera.zoom = 1;
      camera.target = { ...moved.pose.world };
      gm.stateCoordinator.setViewMode(camera.topDown ? 'topdown' : 'isometric', {
        remember: false,
      });
      gm.threeSceneManager.restoreView(camera);
    } else await gm.token3DAdapter.restoreStablePlacement(token, moved);
    if (plan.openingCrossing && follows) {
      const original = before.creatures.find((entry) => entry.id === token.id);
      const animation = gm.token3DAdapter.playOpeningCrossing(token, plan, original);
      gm.campaignTraversalAnimating = true;
      notifyCampaignViewState(gm);
      await animation;
      await gm.token3DAdapter.restoreStablePlacement(token, moved);
    } else if (plan.connectionMotion && follows) {
      const original = before.creatures.find((entry) => entry.id === token.id);
      const animation = gm.token3DAdapter.playConnectionRoute(token, plan, original);
      gm.campaignTraversalAnimating = true;
      notifyCampaignViewState(gm);
      await animation;
      await gm.token3DAdapter.restoreStablePlacement(token, moved);
    }
    gm.campaignTravel.arrived = true;
    gm.campaignMapTransition = false;
    await gm.token3DAdapter.setSelectedToken(
      follows ? token : selected?.mapId === gm.campaignMapId ? selected : null
    );
    await gm.token3DAdapter.syncMapProjections();
    gm.sceneAutosave?.changed('connection travel');
    await gm.sceneAutosave?.flush();
    committed = true;
    if (ticket) session.finishMovement(ticket, plan.costFeet);
    if (plan.free && token.characterSheetId && plan.costFeet > 0)
      session.completeFreeMovement(token);
    return { connectionId, mapId: token.mapId, costFeet: plan.costFeet };
  } catch (error) {
    gm.token3DAdapter.cancelOpeningCrossing(token, error);
    gm.campaignTraversalAnimating = false;
    if (committed) {
      gm.campaignMapFailure = new AggregateError(
        [error],
        'Travel was saved, but its presentation could not finish. Reload to reopen the saved location.'
      );
      throw gm.campaignMapFailure;
    }
    try {
      if (before) {
        gm.campaignMapTransition = true;
        gm.campaignTravel.arrived = false;
        gm.campaignWorld.acceptCheckpoint(before);
        const original = before.creatures.find((actor) => actor.id === token.id);
        token.mapId = original.mapId;
        token.gridX = original.gridX;
        token.gridY = original.gridY;
        token.world = { ...original.pose.world };
        token.facingAngle = original.facingAngle;
        if (original.pose.kind === 'flight') token.flightActive = true;
        else delete token.flightActive;
        gm.campaignView.showMap(before.view.mapId);
        if (before.view.focusTokenId) gm.campaignView.focus(before.view.focusTokenId);
        gm.campaignMapId = before.view.mapId;
        if (changesMap) await restoreMapVisuals(gm, before, before.view.mapId);
        else await gm.token3DAdapter.restoreStablePlacement(token, original);
        gm.threeSceneManager.restoreView(before.view.camera);
        gm.campaignMapTransition = false;
        await gm.token3DAdapter.setSelectedToken(selected);
        await gm.token3DAdapter.syncMapProjections();
      }
    } catch (rollbackError) {
      gm.campaignMapFailure = new AggregateError(
        [error, rollbackError],
        'Travel could not be restored. Reload to reopen the last saved location.'
      );
      throw gm.campaignMapFailure;
    } finally {
      if (ticket && session.moves.get(ticket.id) === ticket) session.finishMovement(ticket, 0);
    }
    throw error;
  } finally {
    gm.campaignTravel = null;
    gm.campaignTraversalAnimating = false;
    gm.campaignMapTransition = false;
    gm.campaignViewBusy = false;
    notifyCampaignViewState(gm);
    gm.token3DAdapter.refreshMovementRange();
  }
}

export async function changeCampaignView(gm, { mapId = null, focusTokenId = null } = {}) {
  if (!gm.campaignWorld || !gm.campaignView)
    throw new Error('This campaign does not have connected maps');
  if (gm.campaignMapFailure) throw gm.campaignMapFailure;
  if (gm.campaignViewBusy) throw new Error('Wait for the current map change to finish');
  const combat = gm.characterServices.combat;
  if (
    gm.sceneAutosave?.ready === false ||
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
    await gm.sceneAutosave?.flush({ waitForScene: false });
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
    await gm.sceneAutosave?.flush({ waitForScene: false });
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
