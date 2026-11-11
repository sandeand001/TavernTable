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

  async presentation(world, mapId, assetKey) {
    const { playerRenderAssets } = await import(
      pathToFileURL(path.join(this.root, 'src', 'campaigns', 'PlayerPresentation.js')).href
    );
    const assets = playerRenderAssets(world, mapId);
    const publicKey = createHash('sha256').update(JSON.stringify(assets)).digest('hex');
    return { version: 1, assetKey: publicKey, assets: publicKey === assetKey ? null : assets };
  }

  async view({
    scene,
    library,
    ownedIds,
    mapId = null,
    terrainKey = null,
    observerTokenId = null,
    presentationVersion = null,
    assetKey = null,
    placementGrant = null,
    noObserver = false,
  }) {
    const { emptyPlayerScene } = await import(
      pathToFileURL(path.join(this.root, 'src', 'campaigns', 'PlayerPublicProtocol.js')).href
    );
    if (presentationVersion !== null && presentationVersion !== 1)
      throw Object.assign(new Error('Unsupported player presentation version'), {
        status: 400,
        code: 'unsupported-presentation',
      });
    const maps = this.maps(scene);
    if (!maps.length) {
      if (mapId)
        throw Object.assign(new Error('This map is not published to players'), { status: 403 });
      return {
        maps: [],
        view: null,
        observers: [],
        observerTokenId: null,
        publicScene: emptyPlayerScene(),
      };
    }
    const [{ default: CampaignWorld }, { playerCreatureVisibility }] = await Promise.all([
      import(pathToFileURL(path.join(this.root, 'src', 'campaigns', 'CampaignWorld.js')).href),
      import(pathToFileURL(path.join(this.root, 'src', 'campaigns', 'CreatureVisibility.js')).href),
    ]);
    const world = CampaignWorld.fromScene(scene, { ruleset: scene.ruleset, library });
    if (placementGrant) {
      if (presentationVersion !== 1 || observerTokenId !== null)
        throw Object.assign(
          new Error('Placement preview requires render version 1 and no observer'),
          {
            status: 400,
            code: 'invalid-placement-preview',
          }
        );
      if (scene.creatures.some((entry) => entry.characterId === placementGrant.characterId))
        throw Object.assign(new Error('Choose the placed character as your real observer'), {
          status: 409,
          code: 'character-already-placed',
        });
      const selected = maps.find((entry) => entry.id === placementGrant.mapId);
      if (!selected || (mapId !== null && mapId !== selected.id))
        throw Object.assign(new Error('The placement destination is not available'), {
          status: 403,
          code: 'placement-unavailable',
        });
      return {
        maps: world.listLocationMaps(selected.id),
        observers: [],
        observerTokenId: null,
        publicScene: emptyPlayerScene(),
        location: world
          .listLocations()
          .find((entry) => entry.id === world.getLocationId(selected.id)),
        view: {
          id: selected.id,
          name: selected.name,
          mode: 'placement-preview',
          grid: selected.grid,
          terrain: null,
          tokens: [],
          presentation: await this.presentation(world, selected.id, assetKey),
        },
      };
    }
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
    if (noObserver || !visibility.observer) {
      if (mapId)
        throw Object.assign(new Error('Choose an assigned creature before viewing a location'), {
          status: 403,
        });
      return {
        maps: [],
        view: null,
        observers,
        observerTokenId: null,
        publicScene: emptyPlayerScene(),
      };
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
    const presentation = await this.presentation(world, visibility.observer.mapId, assetKey);
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
    if (presentationVersion !== 1 && key !== terrainKey) {
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
      const character = token.characterId ? library.get(token.characterId) : null;
      return {
        id: token.id,
        name: token.name,
        type: token.type,
        characterId: ownedIds.includes(token.characterId) ? token.characterId : null,
        world: projection.world,
        facingAngle: projection.facingAngle,
        allegiance: token.allegiance || 'neutral',
        pose: token.pose.kind,
        mapId: token.mapId,
        gridX: token.gridX,
        gridY: token.gridY,
        placement: {
          mapId: token.mapId,
          gridX: token.gridX,
          gridY: token.gridY,
          facingAngle: token.facingAngle,
          pose: JSON.parse(JSON.stringify(token.pose)),
        },
        portraitImage: character?.portraitImage || null,
        movement: { mode: token.movement.mode, type: token.movement.type },
        flags: {
          prone: (character?.conditions || token.conditions || []).includes('prone'),
          flightActive: token.pose.kind === 'flight',
        },
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
      publicScene: {
        ...presentation,
        presentation: { mapId: selected.id, focusTokenId: visibility.observer.id },
        actors: tokens.map((token) => ({
          id: token.id,
          name: token.name,
          type: token.type,
          owned: token.characterId !== null,
          characterId: token.characterId,
          mapId: token.mapId,
          gridX: token.gridX,
          gridY: token.gridY,
          pose: token.placement.pose,
          facingAngle: token.placement.facingAngle,
          portraitImage: token.portraitImage,
          movement: token.movement,
          flags: token.flags,
        })),
        updates: [],
      },
      view: {
        id: selected.id,
        name: selected.name,
        grid: selected.grid,
        terrainKey: key,
        terrain,
        tokens,
        ...(presentationVersion === 1 ? { presentation } : {}),
      },
    };
  }
}

module.exports = { PublishedMaps };
