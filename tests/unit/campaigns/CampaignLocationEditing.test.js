import { createCampaignLocation } from '../../../src/campaigns/CampaignLocationEditing.js';
import { restoreCampaignScene } from '../../../src/campaigns/SceneWorld.js';
import { createCampaignBoard } from '../../helpers/campaignBoard.js';
import { sceneState } from '../../helpers/sceneState.js';
import { CharacterLibrary } from '../../../src/entities/characters/CharacterLibrary.js';

let gm;
let library;
beforeEach(async () => {
  localStorage.clear();
  library = new CharacterLibrary({ ruleset: '2014', catalog: [], storage: localStorage });
  gm = createCampaignBoard(library);
  const scene = sceneState();
  scene.terrain.heights = scene.terrain.heights.map((row) => row.map(() => 0));
  await restoreCampaignScene(gm, scene, library, gm.characterServices.combat);
});
afterEach(() => {
  for (const token of [...gm.placedTokens]) gm.tokenManager.removeToken(token);
  gm.token3DAdapter.disposeMovementRange();
});

test('explicit location creation safely promotes a legacy board while retaining its actors and physical positions', async () => {
  const actor = gm.placedTokens[0];
  const before = { ...actor.world };
  let saved;
  library.saveScene = jest.fn(async (capture) => {
    saved = capture();
    return { captured: saved };
  });
  const created = await createCampaignLocation(gm, 'New world');
  expect(saved.scene.version).toBe(3);
  expect(gm.campaignWorld.listLocations()).toHaveLength(2);
  expect(gm.campaignWorld.getLocationId(created.mapId)).toBe(created.id);
  expect(gm.campaignMapId).toBe('map-main');
  expect(gm.placedTokens[0]).toBe(actor);
  expect(actor.world).toEqual(before);
  expect(actor.mapId).toBe('map-main');
  expect(gm.campaignViewBusy).toBe(false);
  expect(gm.characterServices.combat.turn).toBe(0);
});

test('location creation refuses an unfinished route without saving any partial world', async () => {
  library.saveScene = jest.fn();
  const moving = jest.spyOn(gm.token3DAdapter, 'isMovementInProgress').mockReturnValue(true);
  try {
    await expect(createCampaignLocation(gm, 'Unsafe edit')).rejects.toThrow('Finish');
    expect(library.saveScene).not.toHaveBeenCalled();
    expect(gm.campaignWorld).toBeFalsy();
  } finally {
    moving.mockRestore();
  }
});
