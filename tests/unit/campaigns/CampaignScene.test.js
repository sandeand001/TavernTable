import { encodeScene, decodeScene } from '../../../src/campaigns/CampaignScene.js';
import { CharacterLibrary } from '../../../src/entities/characters/CharacterLibrary.js';
import { sceneState } from '../../helpers/sceneState.js';

test('scene data roundtrips names, terrain and linked identities while rejecting another edition or missing character', () => {
  localStorage.clear();
  const library = new CharacterLibrary({ catalog: [], ruleset: '2014', storage: localStorage });
  const id = library.create('Rook');
  const scene = sceneState({ characterId: id });
  const context = { ruleset: '2014', library };
  expect(decodeScene(encodeScene(scene, context), context)).toEqual(scene);
  expect(() => decodeScene(JSON.stringify(scene), { ruleset: '2024', library })).toThrow('ruleset');
  const missing = sceneState({ characterId: 'missing-character' });
  expect(() => encodeScene(missing, context)).toThrow('character');
  const corrupt = sceneState({ characterId: id });
  corrupt.camera.zoom = NaN;
  expect(() => encodeScene(corrupt, context)).toThrow('camera');
});

test('flight poses roundtrip at their absolute altitude and cannot be restored inside terrain', () => {
  localStorage.clear();
  const library = new CharacterLibrary({ catalog: [], ruleset: '2014', storage: localStorage });
  const id = library.create('Rook');
  library.edit(id, { fallTraits: { flySpeed: 60 } });
  const scene = sceneState({ characterId: id });
  scene.creatures[0].pose = { kind: 'flight', world: { x: 1.5, y: 3, z: 1.5 } };
  const context = { ruleset: '2014', library };
  expect(decodeScene(encodeScene(scene, context), context).creatures[0].pose).toEqual(
    scene.creatures[0].pose
  );
  scene.creatures[0].pose.world.y = 0;
  expect(() => encodeScene(scene, context)).toThrow('flight altitude');
});
