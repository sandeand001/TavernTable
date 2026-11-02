import {
  getTokenCharacterRecord,
  getTokenConditions,
} from '../entities/creatures/TokenMovement.js';
import { clearSegment, finitePoint } from '../rules/targeting/geometry.js';
import {
  TARGET_ALLEGIANCES,
  TARGET_CREATURE_TYPES,
  TARGET_CREATURE_SIZES,
} from '../config/targeting/SpellProfiles.js';

export function targetingPositions(gameManager, groundTokenIds = []) {
  const gm = gameManager,
    spatial = gm.spatial;
  if (!spatial || !Number.isFinite(spatial.tileWorldSize) || spatial.tileWorldSize <= 0)
    throw new Error('Targeting needs the board’s physical grid scale');
  const tileSize = spatial.tileWorldSize;
  const projected = new Set(groundTokenIds);
  const tokens = gm.placedTokens.map((token) => {
    const world =
      token.world ||
      spatial.gridToWorld(
        token.gridX + 0.5,
        token.gridY + 0.5,
        gm.getTerrainHeight(token.gridX, token.gridY)
      );
    if (!finitePoint(world)) throw new Error('A target creature has no valid position');
    const position = { id: token.id, world: { ...world } };
    if (projected.has(token.id)) {
      const ground = gm.token3DAdapter?.getTokenGroundPosition?.(token);
      if (!finitePoint(ground))
        throw new Error('A flight indicator needs a valid ground projection');
      position.groundWorld = { ...ground };
    }
    return position;
  });
  return { tokens, tileSize };
}

export function targetingBoard(gameManager, groundTokenIds = []) {
  const gm = gameManager,
    spatial = gm.spatial;
  const positions = targetingPositions(gm, groundTokenIds);
  const tileSize = positions.tileSize;
  const tokens = gm.placedTokens.map((token, index) => {
    const character =
      getTokenCharacterRecord(token) ||
      (token.characterSheetId ? gm.characterServices.library.get(token.characterSheetId) : null);
    const position = positions.tokens[index];
    const allegiance = token.allegiance || 'neutral';
    const creatureType = token.creatureType || 'humanoid';
    const creatureSize = token.creatureSize || 'medium';
    if (
      !TARGET_ALLEGIANCES.includes(allegiance) ||
      !TARGET_CREATURE_TYPES.includes(creatureType) ||
      !TARGET_CREATURE_SIZES.includes(creatureSize)
    )
      throw new Error('Creature targeting tags are invalid');
    return {
      ...position,
      name: character?.name || token.name || token.type,
      allegiance,
      creatureType,
      creatureSize,
      facingAngle: token.facingAngle ?? 0,
      hpCurrent: character?.hp.current ?? null,
      conditions: [...getTokenConditions(token)],
      abilities: character ? gm.characterServices.library.stats(character.id).abilityScores : {},
      gridX: token.gridX,
      gridY: token.gridY,
    };
  });
  const obstacles = [];
  for (let y = 0; y < gm.rows; y++)
    for (let x = 0; x < gm.cols; x++) {
      const height = gm.getTerrainHeight(x, y);
      if (!Number.isFinite(height)) throw new Error('Targeting terrain height is invalid');
      const low = spatial.gridToWorld(x, y, height),
        high = spatial.gridToWorld(x + 1, y + 1, height);
      obstacles.push({
        min: { x: Math.min(low.x, high.x), y: -1000000, z: Math.min(low.z, high.z) },
        max: {
          x: Math.max(low.x, high.x),
          y: low.y - tileSize * 0.002,
          z: Math.max(low.z, high.z),
        },
      });
    }
  if (gm.placeableMeshPool) obstacles.push(...gm.placeableMeshPool.targetingCoverBounds());
  const eye = (token) => ({ ...token.world, y: token.world.y + tileSize * 0.8 });
  const center = (token) => ({ ...token.world, y: token.world.y + tileSize * 0.5 });
  return {
    tokens,
    tileSize,
    coverKey: JSON.stringify(obstacles),
    inside: (point) => {
      const grid = spatial.worldToGrid(point.x, point.z);
      return grid.gridX >= 0 && grid.gridY >= 0 && grid.gridX < gm.cols && grid.gridY < gm.rows;
    },
    clearPath: (actor, target) => clearSegment(eye(actor), center(target), obstacles),
    clearPoint: (actor, point) =>
      clearSegment(eye(actor), { ...point, y: point.y + tileSize * 0.01 }, obstacles),
    clearArea: (origin, target) =>
      clearSegment({ ...origin, y: origin.y + tileSize * 0.5 }, center(target), obstacles),
  };
}
