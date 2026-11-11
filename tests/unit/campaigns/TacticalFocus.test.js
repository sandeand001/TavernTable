import { TerrainEngine } from '../../../src/terrain/TerrainEngine.js';
import { reconcileBuildingScene } from '../../../src/campaigns/BuildingAssembly.js';
import CampaignWorld from '../../../src/campaigns/CampaignWorld.js';
import CampaignStore from '../../../src/campaigns/CampaignStore.js';
import CampaignCharacters from '../../../src/campaigns/CampaignCharacters.js';
import CampaignAutosave from '../../../src/campaigns/CampaignAutosave.js';
import { changeCampaignView } from '../../../src/campaigns/SceneWorld.js';
import { decodeScene } from '../../../src/campaigns/CampaignScene.js';
import { createCampaignBoard } from '../../helpers/campaignBoard.js';
import { testIndexedDB } from '../../helpers/indexedDB.js';
import { sceneState } from '../../helpers/sceneState.js';

test.each([false, true])(
  'focusing an empty ladder cellar saves and reopens without moving its creature; legacy empty geometry=%s',
  async (legacyEmpty) => {
    const store = new CampaignStore({
      indexedDB: testIndexedDB(),
      packs: [{ id: 'srd-2014', ruleset: '2014', version: '5.1', core: true }],
    });
    let gm;
    let autosave;
    try {
      const campaign = await store.create({ name: 'Cellar focus regression', ruleset: '2014' });
      const catalog = { ruleset: '2014', entries: [], classes: [], enabledEntryIds: [] };
      const library = await CampaignCharacters.open({ store, campaignId: campaign.id, catalog });
      const characterId = await library.create('Cellar scout');
      const engine = new TerrainEngine(25, 25);
      for (const [id, kind, heightFeet, building] of [
        ['hall', 'building', 20, { roof: 'battlement' }],
        [
          'cellar',
          'cellar',
          10,
          {
            access: { kind: 'ladder', structureId: 'hall', xFeet: 0, zFeet: 0 },
          },
        ],
      ]) {
        engine.placeStructure({
          id,
          kind,
          heightFeet,
          building,
          xFeet: 60,
          zFeet: 60,
          lengthFeet: 40,
          widthFeet: 30,
        });
      }
      const scene = sceneState({ characterId, name: 'Cellar scout' });
      scene.version = 2;
      scene.grid = { cols: 25, rows: 25, tileWorldSize: 1 };
      scene.terrain.heights = engine.save().heights;
      scene.terrain.geometry = engine.geometry.save();
      const context = { ruleset: '2014', library };
      const assembled = reconcileBuildingScene(scene, context);
      const cellar = assembled.maps.find((map) => map.building?.structureId === 'cellar');
      expect(cellar.terrain.geometry.volumes).toEqual([]);
      if (legacyEmpty) delete cellar.terrain.geometry;
      const world = CampaignWorld.fromScene(assembled, context);
      const position = world.toMapPosition(cellar.id, { x: 47.5, y: -10, z: 52.5 });
      expect(world.findLocalSupport(cellar.id, position, { clearanceFeet: 5 })).not.toBeNull();
      Object.assign(assembled.creatures[0], {
        mapId: cellar.id,
        gridX: Math.floor(position.x),
        gridY: Math.floor(position.z),
        pose: { kind: 'ground', world: position },
      });
      const original = JSON.parse(JSON.stringify(assembled.creatures[0]));
      gm = createCampaignBoard(library);
      autosave = new CampaignAutosave({
        gameManager: gm,
        library,
        combat: gm.characterServices.combat,
      });
      await autosave.start(assembled);
      const actor = gm.placedTokens[0];
      await changeCampaignView(gm, { focusTokenId: actor.id });
      expect(gm.campaignMapId).toBe(cellar.id);
      expect(gm.campaignView.focusTokenId).toBe(actor.id);
      expect(gm.threeSceneManager.snapshotView().target).toEqual(position);
      expect(actor.world).toEqual(original.pose.world);
      expect(autosave.status.state).toBe('saved');
      const reopened = await CampaignCharacters.open({ store, campaignId: campaign.id, catalog });
      const saved = decodeScene(reopened.savedScene, { ruleset: '2014', library: reopened });
      expect(saved.maps.find(({ id }) => id === cellar.id).terrain.geometry).toEqual({
        version: 1,
        volumes: [],
      });
      expect(saved.creatures[0].pose.world).toEqual(position);
      expect(saved.view.focusTokenId).toBe(actor.id);
      await changeCampaignView(gm, { mapId: 'map-main' });
      expect(gm.campaignMapId).toBe('map-main');
      expect(actor.world).toEqual(position);
      expect(autosave.status.state).toBe('saved');
    } finally {
      autosave?.dispose();
      if (gm) {
        for (const token of [...gm.placedTokens]) gm.tokenManager.removeToken(token);
        gm.token3DAdapter.disposeMovementRange();
        gm.token3DAdapter.disposeMapProjectionTerrain();
      }
      store.close();
    }
  }
);
