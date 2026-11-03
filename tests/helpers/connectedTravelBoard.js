import { CharacterLibrary } from '../../src/entities/characters/CharacterLibrary.js';
import { CompendiumCatalog } from '../../src/entities/characters/CompendiumCatalog.js';
import { restoreCampaignScene, travelCampaignConnection } from '../../src/campaigns/SceneWorld.js';
import { createTwoFloorTravelScene } from '../../src/campaigns/examples/ConnectedTravelExample.js';
import { connectCharacterServices } from '../../src/ui/characters/characterServices.js';
import { createCampaignBoard } from './campaignBoard.js';
import { PickingService } from '../../src/scene/picking/PickingService.js';
import classic from '../../assets/data/resources/srd-2014-5.1-seed.1.json';
import { TerrainVolumeMeshBuilder } from '../../src/scene/terrain/TerrainVolumeMeshBuilder.js';
import { stepHumanoid } from './humanoid-fixture.js';

export async function completeConnectionTravel(
  gm,
  actor,
  connectionId,
  options = {},
  observe = () => {}
) {
  return settleConnectionTravel(
    gm,
    actor,
    travelCampaignConnection(gm, actor, connectionId, options),
    observe
  );
}

export async function settleConnectionTravel(gm, actor, operation, observe = () => {}) {
  let outcome;
  operation.then(
    (value) => {
      outcome = { value };
    },
    (error) => {
      outcome = { error };
    }
  );
  const adapter = gm.token3DAdapter;
  for (let frame = 0; frame < 6000 && !outcome; frame++) {
    if (actor.__threeMesh && (!gm.campaignViewBusy || gm.campaignTraversalAnimating))
      stepHumanoid({ adapter, token: actor, mesh: actor.__threeMesh }, 1 / 30);
    gm.advanceFrame();
    await observe();
    await Promise.resolve();
    if (frame % 30 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
  }
  if (!outcome) throw new Error('The confirmed connection travel did not settle');
  if (outcome.error) throw outcome.error;
  return outcome.value;
}

export function addPhysicalTerrain(gm) {
  const mesh = new three.Mesh(
    new three.BufferGeometry(),
    new three.MeshBasicMaterial({ side: three.DoubleSide })
  );
  mesh.name = 'TerrainMesh';
  const update = () => {
    mesh.geometry.dispose();
    mesh.geometry = new TerrainVolumeMeshBuilder().build({
      geometry: gm.terrainEngine.geometry,
      three,
      worldUnitsPerFoot: gm.spatial.tileWorldSize / 5,
    });
    mesh.updateMatrixWorld(true);
  };
  update();
  gm.threeSceneManager.scene.add(mesh);
  const unsubscribe = gm.terrainEngine.onChanged(update);
  return () => {
    unsubscribe();
    mesh.geometry.dispose();
    mesh.material.dispose();
    mesh.removeFromParent();
  };
}

export async function createConnectedTravelBoard({
  mapId = 'map-main',
  position = null,
  library = null,
  scene = null,
  sceneFactory = createTwoFloorTravelScene,
} = {}) {
  const catalog = new CompendiumCatalog({
    version: 1,
    ruleset: '2014',
    entries: classic.entries,
    classes: classic.classes,
  });
  if (!library) {
    localStorage.clear();
    library = new CharacterLibrary({
      ruleset: '2014',
      catalog: catalog.entries,
      classes: catalog.classes,
      storage: localStorage,
    });
  }
  if (!scene) {
    const characters = [];
    for (const name of ['Pathfinder', 'Lower Window Lookout', 'Upper Window Lookout'])
      characters.push(library.get(await library.create(name)));
    scene = sceneFactory({ ruleset: '2014', characters });
  }
  if (position) {
    scene.creatures[0].mapId = mapId;
    scene.creatures[0].gridX = Math.floor(position.x);
    scene.creatures[0].gridY = Math.floor(position.z);
    scene.creatures[0].pose.world = { ...position };
    scene.view.mapId = mapId;
    scene.view.camera.target = { ...position };
  }
  const gm = createCampaignBoard(library);
  gm.characterServices = null;
  connectCharacterServices(gm, { library, catalog });
  await restoreCampaignScene(gm, scene, library, gm.characterServices.combat);
  return gm;
}

export function disposeConnectedTravelBoard(gm) {
  gm.sceneAutosave?.dispose();
  gm.characterServices.targeting.dispose();
  gm.characterServices.falling.dispose();
  for (const token of [...gm.placedTokens]) gm.tokenManager.removeToken(token);
  gm.token3DAdapter.disposeMapProjectionTerrain();
  gm.token3DAdapter.disposeMovementRange();
}

export function addPointerView(gm, target, position) {
  const canvas = document.createElement('canvas');
  canvas.width = 800;
  canvas.height = 600;
  canvas.getBoundingClientRect = () => ({
    left: 0,
    top: 0,
    width: 800,
    height: 600,
    right: 800,
    bottom: 600,
  });
  document.body.append(canvas);
  const camera = new three.PerspectiveCamera(45, 4 / 3, 0.1, 1000);
  camera.position.copy(position);
  camera.lookAt(target);
  camera.updateMatrixWorld(true);
  gm.threeSceneManager.camera = camera;
  gm.threeSceneManager.canvas = canvas;
  gm.threeSceneManager.scene.updateMatrixWorld(true);
  gm.getEventCanvas = () => canvas;
  gm.pickingService = new PickingService({ gameManager: gm });
  return canvas;
}

export function clickFeature(canvas, options = {}) {
  const event = new MouseEvent('pointerdown', {
    bubbles: true,
    cancelable: true,
    button: 0,
    clientX: 400,
    clientY: 300,
    ...options,
  });
  canvas.dispatchEvent(event);
  return event;
}
import * as three from 'three';
