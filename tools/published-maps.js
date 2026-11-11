const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { createHash } = require('node:crypto');
const three = require('three');

class PublishedMaps {
  constructor(root) {
    this.root = root;
    this.cache = new Map();
  }

  maps(scene) {
    if (!scene) return [];
    return scene.version === 3
      ? scene.maps
      : [
          {
            id: 'map-main',
            name: 'Main map',
            base: 'ground',
            originFeet: { x: 0, y: 0, z: 0 },
            quarterTurns: 0,
            grid: scene.grid,
            terrain: scene.terrain,
          },
        ];
  }

  async view({
    scene,
    library,
    ownedIds,
    mapId = null,
    terrainKey = null,
    observerTokenId = null,
  }) {
    const maps = this.maps(scene);
    if (!maps.length) {
      if (mapId)
        throw Object.assign(new Error('This map is not published to players'), { status: 403 });
      return { maps: [], view: null, observers: [], observerTokenId: null };
    }
    const [{ default: CampaignWorld }, { playerCreatureVisibility }] = await Promise.all([
      import(pathToFileURL(path.join(this.root, 'src', 'campaigns', 'CampaignWorld.js')).href),
      import(pathToFileURL(path.join(this.root, 'src', 'campaigns', 'CreatureVisibility.js')).href),
    ]);
    const world = CampaignWorld.fromScene(scene, { ruleset: scene.ruleset, library });
    const creatures = scene.creatures.map((token) => ({
      ...token,
      mapId: scene.version === 3 ? token.mapId : 'map-main',
    }));
    const visibility = playerCreatureVisibility({
      world,
      creatures,
      ownedIds,
      publishedIds: maps.map((map) => map.id),
      observerTokenId,
    });
    const observers = visibility.observers.map((token) => ({
      id: token.id,
      name: token.name,
      mapId: token.mapId,
      characterId: token.characterId,
      mapName: world.getMap(token.mapId).name,
      locationId: world.getLocationId(token.mapId),
      locationName: world
        .listLocations()
        .find((location) => location.id === world.getLocationId(token.mapId)).name,
    }));
    if (!visibility.observer) {
      if (mapId)
        throw Object.assign(new Error('Choose an assigned creature before viewing a location'), {
          status: 403,
        });
      return { maps: [], view: null, observers, observerTokenId: null };
    }
    const allowed = maps.filter(
      (map) =>
        world.sharesLocation(map.id, visibility.observer.mapId) &&
        visibility.visibleMapIds.has(map.id)
    );
    const selected = mapId
      ? allowed.find((map) => map.id === mapId)
      : allowed.find((map) => map.id === visibility.observer?.mapId) || allowed[0];
    if (!selected)
      throw Object.assign(new Error('This area is not in the active character location'), {
        status: 403,
      });
    const key = createHash('sha256')
      .update(
        JSON.stringify([
          selected.id,
          visibility.observer.mapId,
          visibility.observer.pose.world,
          [...visibility.visibleMapIds],
          maps.filter((map) => world.sharesLocation(map.id, selected.id)),
          scene.connections || [],
        ])
      )
      .digest('hex');
    let terrain = null;
    if (key !== terrainKey) {
      terrain = this.cache.get(key);
      if (!terrain) {
        const { buildPlayerTerrainView } = await import(
          pathToFileURL(path.join(this.root, 'src', 'scene', 'terrain', 'PlayerTerrainView.js'))
            .href
        );
        const geometry = buildPlayerTerrainView({
          world,
          map: selected,
          observer: visibility.observer,
          visibleMapIds: visibility.visibleMapIds,
          obstacles: visibility.sightGeometry.obstacles,
          three,
        });
        const encode = (attribute) =>
          Buffer.from(
            attribute.array.buffer,
            attribute.array.byteOffset,
            attribute.array.byteLength
          ).toString('base64');
        terrain = {
          encoding: 'float32',
          positions: encode(geometry.getAttribute('position')),
          colors: encode(geometry.getAttribute('color')),
          normals: encode(geometry.getAttribute('normal')),
          constructionMaterials: encode(geometry.getAttribute('constructionMaterial')),
        };
        geometry.dispose();
        if (this.cache.size >= 8) this.cache.delete(this.cache.keys().next().value);
        this.cache.set(key, terrain);
      }
    }
    const tokens = visibility.visible.map((token) => {
      const projection = world.projectCreature(token.id, selected.id);
      return {
        id: token.id,
        name: token.name,
        type: token.type,
        characterId: ownedIds.includes(token.characterId) ? token.characterId : null,
        world: projection.world,
        facingAngle: projection.facingAngle,
        allegiance: token.allegiance || 'neutral',
        pose: token.pose.kind,
      };
    });
    const { nearbyDoors } = await import(
      pathToFileURL(path.join(this.root, 'src', 'campaigns', 'CampaignDoors.js')).href
    );
    return {
      maps: allowed.map(({ id, name }) => ({ id, name })),
      observers,
      observerTokenId: visibility.observer?.id || null,
      doors: nearbyDoors(
        world,
        { mapId: visibility.observer.mapId, world: visibility.observer.pose.world },
        visibility.sightGeometry
      ).map((connection) => ({
        id: connection.id,
        name: connection.name,
        open: connection.open === true,
        locked: connection.locked === true,
      })),
      location: world
        .listLocations()
        .find((location) => location.id === world.getLocationId(visibility.observer.mapId)),
      view: {
        id: selected.id,
        name: selected.name,
        grid: selected.grid,
        terrainKey: key,
        terrain,
        tokens,
      },
    };
  }
}

module.exports = { PublishedMaps };
