import {
  getConstructionPalette,
  CONSTRUCTION_MATERIALS,
} from '../../config/biome/ConstructionPalettes.js';
import { GRID_CONFIG } from '../../config/GameConstants.js';
import { getBiomeColorWithHydrology } from '../../config/biome/BiomePalettes.js';

export function getBuildingFloorAppearance(world, mapId) {
  if (!world || !mapId) return null;
  const map = world.getMap(mapId);
  if (!map.building) return null;
  return (
    world
      .getMapGeometry(map.building.ownerMapId)
      .getStructures()
      .find((spec) => spec.id === map.building.structureId)?.appearance ?? null
  );
}

export function getTerrainLayerColor(
  layerId,
  biomeKey = null,
  materialRole = null,
  materialColor = undefined
) {
  if (materialColor !== undefined) {
    if (!Number.isInteger(materialColor) || materialColor < 0 || materialColor > 0xffffff)
      throw new Error('A terrain material colour must be a 24-bit integer');
    return materialColor;
  }
  if (biomeKey && materialRole) return getConstructionPalette(biomeKey)[materialRole];
  return (
    {
      bridge: 0x9c744b,
      cave: 0x858e91,
      dome: 0xb9a98a,
      castle: 0x92979d,
      ground: 0x808179,
      upper: 0xb9a98a,
      roof: 0x784c43,
    }[layerId] ?? 0x99938c
  );
}

export function getMapTerrainAppearance(world, map) {
  const floor = getBuildingFloorAppearance(world, map.id);
  const feetPerLevel = (map.terrain.worldElevationUnit * 5) / map.grid.tileWorldSize;
  return {
    getStyle: (_x, _z, _y, span) =>
      CONSTRUCTION_MATERIALS[
        floor && span.materialColor === undefined
          ? floor.floorMaterial
          : (span.materialStyle ?? 'none')
      ],
    getColor: (_x, _z, height, span) =>
      span.materialColor !== undefined
        ? getTerrainLayerColor(
            span.layerId,
            map.terrain.biome,
            span.materialRole,
            span.materialColor
          )
        : floor
          ? floor.floorColor
          : span.id === 'terrain'
            ? map.terrain.biome
              ? getBiomeColorWithHydrology(map.terrain.biome, height / feetPerLevel)
              : GRID_CONFIG.TILE_COLOR
            : getTerrainLayerColor(span.layerId, map.terrain.biome, span.materialRole),
  };
}

export function createTerrainMaterial(three, { color = 0x777766 } = {}) {
  try {
    return new three.MeshStandardMaterial({ color, flatShading: false });
  } catch (_) {
    // Fallback stub for non-WebGL test environments.
    return { isMaterial: true, color };
  }
}
