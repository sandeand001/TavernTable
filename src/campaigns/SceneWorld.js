import { normalizeCreatureType } from '../config/CharacterCatalog.js';
import * as TokenMovement from '../entities/creatures/TokenMovement.js';
import { readStablePlacement } from '../scene/token-adapter/SavedPlacements.js';
import { readPlaceablePlacements, captureCameraView } from '../scene/SceneSnapshotReaders.js';
import { snapshotCombat } from '../entities/characters/combat/persistence.js';
import { validateScene } from './CampaignScene.js';

export async function captureCampaignScene(
  gameManager,
  library,
  { combat = gameManager.characterServices.combat, change = null, result = null, rollLog = [] } = {}
) {
  const gm = gameManager;
  const coordinator = gm.terrainCoordinator;
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
    return {
      id: token.id,
      type: normalizeCreatureType(token.type),
      instanceNumber: token.instanceNumber,
      name: character?.name ?? token.name,
      nameMode: character ? 'character' : token.nameMode === 'automatic' ? 'automatic' : 'custom',
      characterId,
      movement: {
        mode: movement.mode,
        type: movement.type,
        ...(character ? {} : { speed: movement.speed }),
      },
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
  if (!savedCombat.states.some((row) => row.tokenId === savedCombat.activeTokenId))
    savedCombat.activeTokenId = null;
  const scene = {
    version: 1,
    ruleset: library.ruleset,
    grid: { cols: gm.cols, rows: gm.rows, tileWorldSize: gm.spatial.tileWorldSize },
    terrain: {
      heights: coordinator.dataStore.working.map((row) => [...row]),
      biome: globalThis.window?.selectedBiome || null,
      seed: coordinator._biomeSeed,
      elevationScale: coordinator.getElevationScale(),
      worldElevationUnit: gm.spatial.elevationUnit,
      treeDensity: coordinator.getTreeDensityMultiplier(),
      richShading: JSON.parse(JSON.stringify(globalThis.window?.richShadingSettings || {})),
      placeables: pool ? readPlaceablePlacements(pool) : [],
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
    if (previousId !== creature.characterId) gameManager.characterServices.combat.forget(token);
  }
  const ids = new Set(library.list().map((character) => character.id));
  for (const id of gameManager.characterServices.combat.histories.keys()) {
    if (!ids.has(id)) gameManager.characterServices.combat.histories.delete(id);
  }
  return changed;
}

export async function restoreCampaignScene(gameManager, scene, library, combat) {
  validateScene(scene, { ruleset: library.ruleset, library });
  const gm = gameManager;
  const terrain = scene.terrain;
  for (const token of [...gm.placedTokens]) gm.tokenManager.removeToken(token);
  gm.resizeGrid(scene.grid.cols, scene.grid.rows);
  gm.spatial.tileWorldSize = scene.grid.tileWorldSize;
  const coordinator = gm.terrainCoordinator;
  coordinator.dataStore.restoreHeights(terrain.heights);
  if (globalThis.window) {
    window.selectedBiome = terrain.biome;
    window.richShadingSettings = JSON.parse(JSON.stringify(terrain.richShading));
  }
  coordinator._lastGeneratedBiomeKey = terrain.biome;
  coordinator.setTreeDensityMultiplier(terrain.treeDensity);
  coordinator.setBiomeSeed(terrain.seed);
  coordinator.setElevationScale(terrain.elevationScale, { repaintBiome: false });
  gm.spatial.elevationUnit = terrain.worldElevationUnit;
  gm.terrainEngine?.load({
    heights: terrain.heights,
    biomeKey: terrain.biome,
    biomeSeed: terrain.seed,
  });
  coordinator.applyBiomePaletteToBaseGrid();
  gm.notifyTerrainHeightsChanged();
  const pool = gm.ensureInstancing();
  if (!pool && terrain.placeables.length)
    throw new Error('The saved terrain placement renderer is unavailable');
  if (pool) await pool.restorePlacements(terrain.placeables);
  const restored = [];
  for (const creature of scene.creatures) {
    const model = gm.tokenManager.createCreatureByType(creature.type);
    if (!model) throw new Error(`The saved creature model "${creature.type}" could not be created`);
    gm.tokenManager.addTokenToCollection(model, creature.gridX, creature.gridY, creature.type);
    const token = gm.placedTokens.at(-1);
    if (!token || token.creature !== model) throw new Error('A saved creature could not be placed');
    token.id = creature.id;
    token.instanceNumber = creature.instanceNumber;
    token.movementSettings = { ...creature.movement };
    if (creature.characterId)
      TokenMovement.linkTokenCharacter(token, library, creature.characterId);
    restored.push({ token, creature });
  }
  for (const { token, creature } of restored) {
    token.name = creature.name;
    token.nameMode = creature.nameMode;
    await gm.token3DAdapter.restoreStablePlacement(token, creature);
  }
  gm.tokenManager._nextTokenId = scene.tokenCounters.nextId;
  gm.tokenManager._tokenTypeCounts = new Map(scene.tokenCounters.types);
  combat.restore(scene.combat, gm.placedTokens);
  gm.token3DAdapter.setSelectedToken(
    gm.placedTokens.find((token) => token.id === scene.selection) || null
  );
  gm.stateCoordinator.setViewMode(scene.camera.topDown ? 'topdown' : 'isometric', {
    remember: false,
  });
  gm.threeSceneManager.restoreView(scene.camera);
}
