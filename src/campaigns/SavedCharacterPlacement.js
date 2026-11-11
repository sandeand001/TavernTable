import CampaignWorld from './CampaignWorld.js';
import { captureCampaignScene, isCampaignActionInProgress } from './SceneWorld.js';
import { applyBuildingScene } from './CampaignBuildingEditor.js';
import { encodeScene } from './CampaignScene.js';
import { getCharacterDefinition, normalizeCreatureType } from '../config/CharacterCatalog.js';
import { getAutomaticCreatureName } from '../entities/creatures/CreatureNames.js';
import { linkTokenCharacter } from '../entities/creatures/TokenMovement.js';
import { boundsIntersectSolid } from '../terrain/ConvexGeometry.js';

function notify(gm) {
  gm.characterServices.combat.syncMovementStatus();
  if (typeof window !== 'undefined')
    window.dispatchEvent(
      new CustomEvent('taverntable:campaignViewStateChanged', {
        detail: { gameManager: gm },
      })
    );
}

function placementPose(gm, scene, world, mapId, gridX, gridY, surface) {
  const map = world.getMap(mapId);
  if (
    !Number.isInteger(gridX) ||
    !Number.isInteger(gridY) ||
    gridX < 0 ||
    gridY < 0 ||
    gridX >= map.grid.cols ||
    gridY >= map.grid.rows
  )
    throw new Error('Choose a placement cell inside the current area');
  if (
    surface &&
    (surface.kind !== 'floor' ||
      !Number.isFinite(surface.point?.y) ||
      (surface.mapId && surface.mapId !== mapId))
  )
    throw new Error('Switch to the desired area and choose a walkable floor for placement');
  const unit = map.grid.tileWorldSize / 5;
  const x = gridX * 5 + 2.5;
  const z = gridY * 5 + 2.5;
  const below = Number.isFinite(surface?.point?.y)
    ? surface.point.y / unit
    : (map.terrain.heights[gridY][gridX] * map.terrain.worldElevationUnit) / unit;
  const geometry = world.getMapGeometry(mapId);
  const support = geometry.findSupport(x, z, { belowFeet: below + 1e-5, clearanceFeet: 5 });
  if (!support)
    throw new Error('The saved character needs a supported floor with standing clearance');
  if (surface && Math.abs(support.heightFeet - below) > 1e-3)
    throw new Error('The chosen floor cannot support a character in this cell');
  const body = {
    min: { x: x - 0.49, y: support.heightFeet + 1e-5, z: z - 0.49 },
    max: { x: x + 0.49, y: support.heightFeet + 5 - 1e-5, z: z + 0.49 },
  };
  if (!geometry.isGroundSpaceClear(body, support.heightFeet + 2.5))
    throw new Error('A wall or solid structure blocks this placement');
  const point = { x: x * unit, y: support.heightFeet * unit, z: z * unit };
  const physicalBody = world.toCampaignBounds(mapId, {
    min: Object.fromEntries(Object.entries(body.min).map(([axis, value]) => [axis, value * unit])),
    max: Object.fromEntries(Object.entries(body.max).map(([axis, value]) => [axis, value * unit])),
  });
  const obstacles = world.getObstacles({ mapId, excludeMapId: mapId });
  for (const bounds of gm.placeableMeshPool?.targetingCoverBounds?.() || [])
    obstacles.push(world.toCampaignBounds(mapId, bounds));
  if (obstacles.some((solid) => boundsIntersectSolid(physicalBody, solid, 1e-6)))
    throw new Error('Another floor or structure blocks this placement');
  const placeables = gm.terrainManager?.placeables?.get(`${gridX},${gridY}`) || [];
  if (placeables.some((entry) => ['plant', 'structure'].includes(entry.placeableType)))
    throw new Error('A blocking placeable occupies this placement cell');
  for (const actor of scene.creatures) {
    const sourceMapId = scene.version === 3 ? actor.mapId : 'map-main';
    if (!world.sharesLocation(sourceMapId, mapId)) continue;
    const other = world.toMapPosition(
      mapId,
      world.toCampaignPosition(sourceMapId, actor.pose.world)
    );
    if (
      Math.floor(other.x / map.grid.tileWorldSize) === gridX &&
      Math.floor(other.z / map.grid.tileWorldSize) === gridY &&
      other.y < point.y + map.grid.tileWorldSize - 1e-7 &&
      other.y + map.grid.tileWorldSize > point.y + 1e-7
    )
      throw new Error('This placement cell is occupied by another creature');
  }
  return {
    kind: 'ground',
    world: point,
    ...(support.id !== 'terrain' ? { surfaceId: support.id } : {}),
  };
}

export async function placeSavedCharacter(
  gm,
  characterId,
  gridX,
  gridY,
  { surface = null, appearance } = {}
) {
  const services = gm.characterServices;
  const library = services?.library;
  if (services?.sessionRole === 'player' || library?.store?.identity?.role === 'player')
    throw new Error('Player character placement requires an authorized DM command');
  library.get(characterId);
  const existing = gm.placedTokens.find((token) => token.characterSheetId === characterId);
  if (existing) return { token: existing, created: false };
  if (
    !library?.saveScene ||
    gm.sceneAutosave?.ready === false ||
    gm.campaignViewBusy ||
    gm.campaignMapFailure ||
    gm.terrainEngine.hasPendingStroke ||
    isCampaignActionInProgress(gm)
  )
    throw new Error(
      'Finish the current action, movement or terrain preview before retrieving a character'
    );
  gm.campaignViewBusy = true;
  let committed = false;
  try {
    notify(gm);
    await gm.sceneAutosave?.flush({ waitForScene: false });
    await library.flush();
    const character = library.get(characterId);
    const definition = getCharacterDefinition(appearance);
    if (!definition) throw new Error('Choose an available token appearance for placement');
    const type = definition.id;
    const scene = await captureCampaignScene(gm, library, {
      completedActionsOnly: true,
      rollLog: gm.sceneAutosave?.getRollLog() || [],
    });
    const context = { ruleset: library.ruleset, library };
    const world = CampaignWorld.fromScene(scene, context);
    const mapId = scene.version === 3 ? gm.campaignMapId || scene.view.mapId : 'map-main';
    const pose = placementPose(gm, scene, world, mapId, gridX, gridY, surface);
    const typeCounts = new Map(scene.tokenCounters.types);
    const instanceNumber = (typeCounts.get(type) || 0) + 1;
    const nextId = scene.tokenCounters.nextId + 1;
    const checkpoint = {
      id: `token-${nextId}`,
      type,
      instanceNumber,
      name: character.name,
      nameMode: 'character',
      characterId,
      ...(scene.version === 3 ? { mapId } : {}),
      gridX,
      gridY,
      facingAngle: 0,
      movement: { mode: 'walk', type: 'default' },
      allegiance: 'neutral',
      creatureType: 'humanoid',
      creatureSize: 'medium',
      pose,
    };
    for (const token of scene.creatures)
      if (
        !token.characterId &&
        token.nameMode === 'automatic' &&
        normalizeCreatureType(token.type) === type
      )
        token.name = getAutomaticCreatureName(type, token.instanceNumber, instanceNumber);
    scene.creatures.push(checkpoint);
    typeCounts.set(type, instanceNumber);
    scene.tokenCounters = { nextId, types: [...typeCounts] };
    if (scene.version === 3) scene.view.focusTokenId = checkpoint.id;
    else scene.selection = checkpoint.id;
    await library.saveScene(() => ({ scene, value: encodeScene(scene, context) }));
    committed = true;
    if (gm.campaignWorld) gm.campaignWorld.acceptCheckpoint(scene);
    else if (scene.version === 3)
      applyBuildingScene(gm, scene, CampaignWorld.fromScene(scene, context));
    const creature = gm.tokenManager.createCreatureByType(type);
    if (!creature) throw new Error('The saved token appearance could not be initialized');
    gm.tokenManager.addTokenToCollection(creature, gridX, gridY, type, null, checkpoint);
    const token = gm.placedTokens.find((entry) => entry.id === checkpoint.id);
    if (!token) throw new Error('The saved token could not be registered in the current scene');
    token.characterSheetId = characterId;
    linkTokenCharacter(token, library, characterId);
    await gm.token3DAdapter.restoreStablePlacement(token, checkpoint);
    if (gm.is3DModeActive?.() && !token.__threeMesh)
      throw new Error('The saved character appearance could not finish loading');
    gm.campaignView?.focus(token.id);
    await gm.token3DAdapter.setSelectedToken(token);
    gm.token3DAdapter.refreshTokenAppearance?.(token);
    return { token, created: true };
  } catch (error) {
    if (committed) {
      gm.campaignMapFailure = new Error(
        'The character placement was saved, but its local appearance could not finish. Reload to restore the saved character.',
        { cause: error }
      );
      throw gm.campaignMapFailure;
    }
    throw error;
  } finally {
    gm.campaignViewBusy = false;
    notify(gm);
  }
}
