import { logger, LOG_CATEGORY } from '../../utils/logger/Logger.js';
import { getPurePolyAsset } from '../../config/assets/PurePolyAssets.js';

const MAX_LOCAL_LIGHTS = 8;

function sourceProfile(biomeKey, source, group) {
  const model = source?.modelKey || source?.placeableId || '';
  if (model === 'source-dungeon-torch')
    return { kind: 'torch', color: 0xffad5c, intensity: 3, radius: 7, height: 0.9 };
  if (getPurePolyAsset(model)?.kind === 'light')
    return { kind: 'lantern', color: 0xffbd70, intensity: 2, radius: 5, height: 0.35 };
  if (biomeKey === 'fungalGrove' && model === 'mushroom-glow')
    return { kind: 'fungus', color: 0xc69cff, intensity: 2, radius: 4, height: 0.4 };
  if (biomeKey === 'fungalGrove' && /^mushroom-/.test(model))
    return { kind: 'fungus', color: 0x8fe8bf, intensity: 2, radius: 4, height: 0.55 };
  if (
    ['crystalFields', 'crystalSpires'].includes(biomeKey) &&
    (/^(?:rock-|pebble-|source-cave-(?:stalagmite|column)$)/.test(model) ||
      getPurePolyAsset(model)?.kind === 'crystal')
  )
    return {
      kind: 'crystal',
      color: group.appearance?.tint ?? getPurePolyAsset(model)?.lightColor ?? 0x82b9ff,
      intensity: 3,
      radius: 5,
      height: 0.8,
    };
  if (biomeKey === 'eldritchRift' && /^(mushroom|rock|pebble)-/.test(model))
    return {
      kind: 'rift',
      color: group.appearance?.tint ?? 0xb38bff,
      intensity: 2,
      radius: 4,
      height: 0.65,
    };
  return null;
}

function clearLocalLights(manager) {
  manager._localLights?.removeFromParent();
  manager._localLights = null;
  manager._localLightingState = null;
}

export function stopUndergroundLighting(manager) {
  if (manager._localLightingTick) manager.removeAnimationCallback(manager._localLightingTick);
  manager._localLightingTick = null;
  manager._localLightingMapId = null;
  clearLocalLights(manager);
}

export function startUndergroundLighting(manager) {
  const mapId = manager.gameManager?.campaignMapId ?? null;
  if (manager._localLightingMapId !== mapId) clearLocalLights(manager);
  manager._localLightingMapId = mapId;
  manager._localLightingState = null;
  if (manager._localLightingTick) return;
  const tick = () => {
    try {
      manager.refreshLocalLighting();
    } catch (error) {
      stopUndergroundLighting(manager);
      logger.error(
        'Underground lighting could not be updated',
        { message: error instanceof Error ? error.message : String(error) },
        LOG_CATEGORY.RENDERING
      );
    }
  };
  manager._localLightingTick = tick;
  manager.addAnimationCallback(tick);
}

export function refreshLocalLighting() {
  if (!this._undergroundLighting || !this.scene || !this.three) return;
  const pool = this._placeablePool;
  const tileSize = this.gameManager?.spatial?.tileWorldSize ?? 1;
  if (!Number.isFinite(tileSize) || tileSize <= 0)
    throw new Error('Underground lighting requires a valid tile size');
  const target = this.getCameraTarget();
  const cameraCell = `${Math.floor(target.x / (4 * tileSize))}:${Math.floor(target.z / (4 * tileSize))}`;
  const previous = this._localLightingState;
  if (
    previous?.pool === pool &&
    previous.revision === pool?._revision &&
    previous.biomeKey === this._sceneLightingBiome &&
    previous.scene === this.scene &&
    previous.tileSize === tileSize &&
    previous.cameraCell === cameraCell
  )
    return;

  const sources = [];
  let caveFill = false;
  for (const [key, entries] of pool?._metadata || []) {
    const group = pool._groups?.get(key) || {};
    for (const entry of entries.values()) {
      if (
        this._sceneLightingBiome === 'cavern' &&
        !entry.source?.metricsOnly &&
        ['formation', 'rock'].includes(getPurePolyAsset(entry.source?.modelKey)?.kind)
      )
        caveFill = true;
      const profile = sourceProfile(this._sceneLightingBiome, entry.source, group);
      if (!profile || entry.source?.metricsOnly) continue;
      if (
        !entry.position ||
        !['x', 'y', 'z'].every((axis) => Number.isFinite(entry.position[axis]))
      )
        throw new Error('An underground light source has no valid rendered position');
      const scale = entry.scale?.y ?? 1;
      if (!Number.isFinite(scale) || scale <= 0)
        throw new Error('An underground light source has an invalid scale');
      sources.push({ entry, profile });
    }
  }
  sources.sort((a, b) => {
    const distance = ({ entry }) =>
      (entry.position.x - target.x) ** 2 + (entry.position.z - target.z) ** 2;
    return (
      distance(a) - distance(b) ||
      a.entry.position.x - b.entry.position.x ||
      a.entry.position.z - b.entry.position.z
    );
  });
  const selected = [];
  const maxPointLights = MAX_LOCAL_LIGHTS - (caveFill ? 1 : 0);
  for (const source of sources) {
    if (
      selected.length < maxPointLights &&
      selected.every(
        (other) =>
          Math.hypot(
            source.entry.position.x - other.entry.position.x,
            source.entry.position.z - other.entry.position.z
          ) >=
          tileSize * 2
      )
    )
      selected.push(source);
  }
  for (const source of sources) {
    if (selected.length >= maxPointLights) break;
    if (!selected.includes(source)) selected.push(source);
  }

  const group = new this.three.Group();
  group.name = 'UndergroundLocalLights';
  group.userData.renderOnly = true;
  if (caveFill) {
    const fill = new this.three.DirectionalLight(0xffffff, 0.8);
    fill.name = 'UndergroundCaveFill';
    fill.position.set(-5, 9, 6);
    fill.castShadow = false;
    fill.userData = { renderOnly: true, kind: 'cave-fill' };
    group.add(fill);
  }
  for (const { entry, profile } of selected) {
    const light = new this.three.PointLight(
      profile.color,
      profile.intensity,
      profile.radius * tileSize,
      2
    );
    light.name = `UndergroundLight:${profile.kind}`;
    light.castShadow = false;
    light.position.set(
      entry.position.x,
      entry.position.y + profile.height * (entry.scale?.y ?? 1),
      entry.position.z
    );
    light.userData = { renderOnly: true, kind: profile.kind };
    group.add(light);
  }
  this.scene.add(group);
  this._localLights?.removeFromParent();
  this._localLights = group;
  this._localLightingState = {
    pool,
    revision: pool?._revision,
    biomeKey: this._sceneLightingBiome,
    scene: this.scene,
    tileSize,
    cameraCell,
  };
}
