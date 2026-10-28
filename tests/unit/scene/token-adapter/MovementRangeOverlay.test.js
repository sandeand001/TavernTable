import * as three from 'three';
import { Token3DAdapter } from '../../../../src/scene/Token3DAdapter.js';
import { ThreeSceneManager } from '../../../../src/scene/ThreeSceneManager.js';
import { setTokenMovementSettings } from '../../../../src/entities/creatures/TokenMovement.js';

function fixture(getHeight = () => 2) {
  const scene = new three.Scene();
  const mesh = new three.Group();
  mesh.userData.__tt3DToken = true;
  scene.add(mesh);
  const token = {
    id: 'token-1',
    type: 'mannequin',
    gridX: 12,
    gridY: 12,
    world: { x: 12.5, y: getHeight(12, 12) * 0.5, z: 12.5 },
    __threeMesh: mesh,
  };
  mesh.position.set(token.world.x, token.world.y, token.world.z);
  const gm = {
    cols: 25,
    rows: 25,
    placedTokens: [token],
    is3DModeActive: () => true,
    getTerrainHeight: getHeight,
    threeSceneManager: { scene, three },
    spatial: {
      tileWorldSize: 1,
      elevationUnit: 0.5,
      gridToWorld: (x, y, height) => ({
        x: x * gm.spatial.tileWorldSize,
        y: height * gm.spatial.elevationUnit,
        z: y * gm.spatial.tileWorldSize,
      }),
      worldToGrid: (x, z) => ({ gridX: Math.floor(x), gridY: Math.floor(z) }),
    },
  };
  const adapter = new Token3DAdapter(gm);
  gm.token3DAdapter = adapter;
  return { adapter, token, gm, scene };
}

describe('Terrain-aligned reachable-tile overlay', () => {
  test('selection outlines the reachable perimeter at terrain height without participating in picking', async () => {
    const { adapter, token, scene } = fixture();
    await adapter.setSelectedToken(token);
    const overlay = scene.getObjectByName('TokenMovementRange');
    expect(overlay.isLineSegments).toBe(true);
    const positions = overlay.geometry.attributes.position;
    expect(positions.count).toBe(168);
    for (let i = 0; i < positions.count; i++) {
      expect(positions.getY(i)).toBeCloseTo(1.008);
      expect([2, 23].includes(positions.getX(i)) || [2, 23].includes(positions.getZ(i))).toBe(true);
    }
    expect(overlay.material.depthTest).toBe(true);
    expect(overlay.material.depthWrite).toBe(false);
    expect(overlay.material.opacity).toBeLessThan(1);
    const hits = [];
    overlay.raycast(new three.Raycaster(), hits);
    expect(hits).toHaveLength(0);
    adapter.disposeMovementRange();
  });

  test('settings update the overlay without accumulating scene meshes', async () => {
    const { adapter, token, scene } = fixture();
    await adapter.setSelectedToken(token);
    const original = scene.getObjectByName('TokenMovementRange');
    setTokenMovementSettings(token, { speed: 10 });
    adapter.refreshMovementRange();
    expect(scene.getObjectByName('TokenMovementRange')).toBe(original);
    expect(original.geometry.attributes.position.count).toBe(40);
    expect(scene.children.filter((item) => item.name === 'TokenMovementRange')).toHaveLength(1);
    adapter.disposeMovementRange();
  });

  test('movement and deselection hide the range; becoming idle restores it', async () => {
    const { adapter, token, scene } = fixture();
    await adapter.setSelectedToken(token);
    const overlay = scene.getObjectByName('TokenMovementRange');
    adapter._movementRoutes.set(token, {});
    adapter.refreshMovementRange();
    expect(overlay.visible).toBe(false);
    adapter._movementRoutes.clear();
    adapter.refreshMovementRange();
    expect(overlay.visible).toBe(true);
    await adapter.setSelectedToken(null);
    expect(overlay.visible).toBe(false);
    adapter.disposeMovementRange();
  });

  test('terrain resync and board resize rebuild current positions and dispose old capacity', async () => {
    let height = 2;
    const { adapter, token, scene, gm } = fixture(() => height);
    await adapter.setSelectedToken(token);
    const original = scene.getObjectByName('TokenMovementRange');
    const geometryDispose = jest.spyOn(original.geometry, 'dispose');
    height = 4;
    adapter.resyncHeights();
    adapter._updatePlannedMovements();
    expect(token.world.y).toBe(2);
    expect(original.geometry.attributes.position.getY(0)).toBeCloseTo(2.008);
    const currentGeometryDispose = jest.spyOn(original.geometry, 'dispose');
    gm.cols = 30;
    adapter.refreshMovementRange();
    expect(geometryDispose).toHaveBeenCalledTimes(1);
    expect(currentGeometryDispose).toHaveBeenCalledTimes(1);
    expect(scene.getObjectByName('TokenMovementRange')).not.toBe(original);
    expect(original.parent).toBeNull();
    adapter.disposeMovementRange();
  });

  test('disposing the range removes its owned rendering resources', async () => {
    const { adapter, token, scene } = fixture();
    await adapter.setSelectedToken(token);
    const overlay = scene.getObjectByName('TokenMovementRange');
    const geometryDispose = jest.spyOn(overlay.geometry, 'dispose');
    const materialDispose = jest.spyOn(overlay.material, 'dispose');
    adapter.disposeMovementRange();
    expect(scene.getObjectByName('TokenMovementRange')).toBeUndefined();
    expect(geometryDispose).toHaveBeenCalledTimes(1);
    expect(materialDispose).toHaveBeenCalledTimes(1);
  });

  test('a terrain-scale change updates costs and overlay heights without reselecting the creature', async () => {
    const { adapter, token, gm, scene } = fixture((x) => (x >= 13 ? 4 : 0));
    setTokenMovementSettings(token, { speed: 15 });
    await adapter.setSelectedToken(token);
    expect(adapter._movementRange.tiles.has('13,12')).toBe(false);
    adapter._updatePlannedMovements();

    gm.spatial.elevationUnit = 0.25;
    adapter._updatePlannedMovements();

    expect(adapter._movementRange.tiles.get('13,12').cost).toBe(15);
    const positions = scene.getObjectByName('TokenMovementRange').geometry.attributes.position;
    expect(
      Array.from({ length: positions.count }, (_, index) => positions.getY(index)).some(
        (height) => Math.abs(height - 1.008) < 1e-5
      )
    ).toBe(true);
    adapter.disposeMovementRange();
  });

  test('another moving creature changing cells invalidates the selected idle creature range', async () => {
    const { adapter, token, gm } = fixture();
    setTokenMovementSettings(token, { speed: 10 });
    const other = { id: 'token-2', gridX: 14, gridY: 12 };
    gm.placedTokens.push(other);
    adapter._movementRoutes.set(other, { cellKey: '14,12' });
    adapter._movementStates.set(other, { phase: 'walk', pathActive: true });
    await adapter.setSelectedToken(token);
    expect(adapter._movementRange.tiles.has('14,12')).toBe(false);
    adapter._updatePlannedMovements();

    other.gridX = 15;
    adapter._updatePlannedMovements();

    expect(adapter._movementRange.tiles.get('14,12').cost).toBe(10);
    adapter.disposeMovementRange();
  });

  test('scene teardown disposes the overlay, not scene construction', () => {
    const disposeMovementRange = jest.fn();
    const scene = new ThreeSceneManager({ token3DAdapter: { disposeMovementRange } });
    expect(disposeMovementRange).not.toHaveBeenCalled();
    scene.dispose();
    expect(disposeMovementRange).toHaveBeenCalledTimes(1);
  });
});
