import * as three from 'three';
import { ThreeSceneManager } from '../../../src/scene/ThreeSceneManager.js';
import PublishedMapViewer from '../../../src/ui/sessions/PublishedMapViewer.js';

jest.mock('../../../src/scene/ThreeSceneManager.js', () => ({ ThreeSceneManager: jest.fn() }));

let container;
let manager;
let viewer;

const encoded = (values) => Buffer.from(new Float32Array(values).buffer).toString('base64');
const view = (tokenId) => ({
  id: 'published',
  grid: { cols: 5, rows: 5, tileWorldSize: 1 },
  terrainKey: 'same-terrain',
  terrain: {
    positions: encoded([0, 0, 0, 0, 0, 1, 1, 0, 0]),
    colors: encoded([0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5]),
  },
  tokens: [
    {
      id: tokenId,
      name: tokenId,
      characterId: 'assigned-character',
      world: { x: 1.5, y: 0, z: 1.5 },
      allegiance: 'friendly',
    },
  ],
});

beforeEach(() => {
  container = document.createElement('section');
  container.id = 'player-map-view';
  document.body.append(container);
  manager = {
    three,
    initialized: true,
    scene: new three.Scene(),
    camera: new three.PerspectiveCamera(50, 1, 0.1, 100),
    canvas: document.createElement('canvas'),
    renderer: { shadowMap: {}, forceContextLoss: jest.fn() },
    initialize: jest.fn(async () => {}),
    setBootstrapGridVisible: jest.fn(),
    reframe: jest.fn(),
    dispose: jest.fn(),
  };
  manager.camera.position.set(5, 5, 5);
  ThreeSceneManager.mockImplementation(() => manager);
  viewer = new PublishedMapViewer(container);
});

afterEach(() => {
  viewer.destroy();
  container.remove();
});

test('switching observer clears old tokens immediately without changing the map geometry or camera', async () => {
  await viewer.update(view('old-observer-visible'));
  const terrain = viewer.terrain;
  const camera = manager.camera.position.clone();
  const target = viewer.controls.target.clone();
  expect(viewer.markers.count).toBe(1);
  expect(viewer.labels.has('old-observer-visible')).toBe(true);

  viewer.clearTokens();

  expect(viewer.markers.count).toBe(0);
  expect(viewer.labels.size).toBe(0);
  expect(viewer.terrain).toBe(terrain);
  expect(viewer.terrainKey).toBe('same-terrain');
  expect(manager.camera.position.equals(camera)).toBe(true);
  expect(viewer.controls.target.equals(target)).toBe(true);

  await viewer.update({ ...view('new-observer-visible'), terrain: null });
  expect(viewer.markers.count).toBe(1);
  expect([...viewer.labels.keys()]).toEqual(['new-observer-visible']);
  expect(viewer.terrain).toBe(terrain);
  expect(manager.camera.position.equals(camera)).toBe(true);
});

test('authorized tactical tokens and labels are not hidden by camera-facing roofs or floors', async () => {
  await viewer.update(view('authorized'));
  expect(viewer.markerMaterial.depthTest).toBe(false);
  expect(viewer.markerMaterial.depthWrite).toBe(false);
  expect(viewer.markers.renderOrder).toBeGreaterThan(viewer.terrain.renderOrder);
  const label = viewer.labels.get('authorized').sprite;
  expect(label.material.depthTest).toBe(false);
  expect(label.material.depthWrite).toBe(false);
  expect(label.renderOrder).toBeGreaterThan(viewer.markers.renderOrder);
});

test('an observer change during renderer initialization cannot add stale creature markers', async () => {
  let release;
  manager.initialize.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      })
  );
  const pending = viewer.update(view('stale-view-only'));
  viewer.clearTokens();
  release();
  await pending;
  expect(viewer.markers?.count || 0).toBe(0);
  expect(viewer.labels.size).toBe(0);
  await viewer.update(view('current-view-only'));
  expect([...viewer.labels.keys()]).toEqual(['current-view-only']);
});
