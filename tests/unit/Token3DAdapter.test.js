import { addTokenToCollection } from '../../src/managers/token-manager/internals/collection.js';

// Minimal hybrid-mode creation test for Token3DAdapter
// We mock dynamic import('three') by injecting a lightweight stand-in into globalThis.importShim style.
// Instead, we simulate by temporarily overriding global import via a jest mock factory is not trivial without bundler;
// so we design the adapter to early-return if three cannot load - here we provide a faux module in module cache using jest.mock.

// jest does static analysis; mock the 'three' module with minimal API we use.
jest.mock('three', () => {
  class Geometry {
    dispose() {}
  }
  class Material {
    dispose() {}
  }
  class PlaneGeometry extends Geometry {
    constructor(w, h) {
      super();
      this.w = w;
      this.h = h;
    }
  }
  class RingGeometry extends Geometry {
    constructor(inner, outer, segments) {
      super();
      this.inner = inner;
      this.outer = outer;
      this.segments = segments;
    }
  }
  class MeshBasicMaterial extends Material {
    constructor(opts) {
      super();
      this.opts = opts;
      this.color = opts?.color
        ? { setHex: jest.fn(), clone: jest.fn(() => ({ setHex: jest.fn(), copy: jest.fn() })) }
        : null;
      this.emissive = opts?.color
        ? { setHex: jest.fn(), clone: jest.fn(() => ({ setHex: jest.fn(), copy: jest.fn() })) }
        : null;
    }
  }
  class Mesh {
    constructor(geo, mat) {
      this.geometry = geo;
      this.material = mat;
      this.position = { set: jest.fn() };
      this.name = '';
      this.userData = {};
      this.rotation = { y: 0 };
      this.scale = { x: 1, y: 1, z: 1 };
      this.children = [];
    }
    lookAt() {}
    add(child) {
      this.children.push(child);
      child.parent = this;
    }
    remove(child) {
      this.children = this.children.filter((c) => c !== child);
      if (child.parent === this) child.parent = null;
    }
  }
  return {
    PlaneGeometry,
    RingGeometry,
    MeshBasicMaterial,
    Mesh,
    DoubleSide: 2,
  };
});

// We import after mocking
import { Token3DAdapter } from '../../src/scene/Token3DAdapter.js';

describe('Token3DAdapter (Phase 3)', () => {
  test('adding a token in hybrid mode schedules a 3D mesh creation and attaches reference', async () => {
    const addedCallbacks = [];
    const fakeScene = { add: jest.fn(), remove: jest.fn() };
    const gm = {
      renderMode: '3d-hybrid',
      threeSceneManager: {
        scene: fakeScene,
        camera: { position: { x: 0, y: 5, z: 5 } },
        addAnimationCallback: (fn) => addedCallbacks.push(fn),
      },
      spatial: { gridToWorld: (x, y) => ({ x, y: 0, z: y }), elevationUnit: 0.5 },
      getTerrainHeight: () => 0,
      placedTokens: [],
      __threeTestDouble: require('three'),
      is3DModeActive: () => true,
    };

    const adapter = new Token3DAdapter(gm);
    gm.token3DAdapter = adapter;
    adapter.attach();

    const c = {
      selectedTokenType: 'goblin',
      placedTokens: gm.placedTokens,
      setupTokenInteractions: () => {},
      gameManager: gm,
    };
    const creature = { sprite: {}, removeFromStage: () => {} };

    addTokenToCollection(c, creature, 2, 3);

    const token = gm.placedTokens[0];
    if (token.__threeMeshPromise) await token.__threeMeshPromise; // still safe

    expect(gm.placedTokens[0].__threeMesh).toBeDefined();
    expect(fakeScene.add).toHaveBeenCalledTimes(1);
    // After consolidation there should be exactly one unified frame callback
    expect(addedCallbacks.length).toBe(1);
  });

  test('removing a token calls adapter cleanup and disposes mesh', async () => {
    const fakeScene = { add: jest.fn(), remove: jest.fn() };
    const gm = {
      renderMode: '3d-hybrid',
      threeSceneManager: {
        scene: fakeScene,
        camera: { position: { x: 0, y: 0, z: 0 } },
        addAnimationCallback: () => {},
      },
      spatial: { gridToWorld: (x, y) => ({ x, y: 0, z: y }), elevationUnit: 0.5 },
      getTerrainHeight: () => 0,
      placedTokens: [],
      __threeTestDouble: require('three'),
      is3DModeActive: () => true,
    };
    const adapter = new Token3DAdapter(gm);
    gm.token3DAdapter = adapter;
    adapter.attach();

    const c = {
      selectedTokenType: 'orc',
      placedTokens: gm.placedTokens,
      setupTokenInteractions: () => {},
      gameManager: gm,
    };
    const creature = { sprite: {}, removeFromStage: () => {} };
    addTokenToCollection(c, creature, 1, 1);
    const token = gm.placedTokens[0];
    if (token.__threeMeshPromise) await token.__threeMeshPromise;
    const mesh = token.__threeMesh;
    jest.spyOn(mesh.geometry, 'dispose');
    jest.spyOn(mesh.material, 'dispose');

    // Use removal path
    const { removeToken } = await import('../../src/managers/token-manager/internals/removal.js');
    removeToken(c, token);

    expect(fakeScene.remove).toHaveBeenCalledWith(mesh);
    expect(mesh.geometry.dispose).toHaveBeenCalled();
    expect(mesh.material.dispose).toHaveBeenCalled();
    expect(token.__threeMesh).toBeUndefined();
  });

  test('facing direction sync flips mesh scale.x', async () => {
    const addedCallbacks = [];
    const fakeScene = { add: jest.fn(), remove: jest.fn() };
    const gm = {
      renderMode: '3d-hybrid',
      threeSceneManager: {
        scene: fakeScene,
        camera: { position: { x: 0, y: 5, z: 5 } },
        addAnimationCallback: (fn) => addedCallbacks.push(fn),
      },
      spatial: { gridToWorld: (x, y) => ({ x, y: 0, z: y }), elevationUnit: 0.5 },
      getTerrainHeight: () => 0,
      placedTokens: [],
      __threeTestDouble: require('three'),
      tokenManager: {
        tokenFacingRight: true,
        getTokenFacingRight() {
          return this.tokenFacingRight;
        },
      },
      is3DModeActive: () => true,
    };
    const adapter = new Token3DAdapter(gm);
    gm.token3DAdapter = adapter;
    adapter.attach();

    const c = {
      selectedTokenType: 'goblin',
      placedTokens: gm.placedTokens,
      setupTokenInteractions: () => {},
      gameManager: gm,
    };
    const creature = { sprite: {}, removeFromStage: () => {} };
    addTokenToCollection(c, creature, 0, 0);
    const token = gm.placedTokens[0];
    if (token.__threeMeshPromise) await token.__threeMeshPromise;
    const mesh = token.__threeMesh;
    mesh.scale = { x: 1, y: 1, z: 1 };

    // Run all registered animation callbacks once to capture initial state
    addedCallbacks.forEach((cb) => cb());
    expect(mesh.scale.x).toBe(1);

    // Flip facing
    gm.tokenManager.tokenFacingRight = false;
    addedCallbacks.forEach((cb) => cb());
    expect(mesh.scale.x).toBe(-1);

    // Flip back
    gm.tokenManager.tokenFacingRight = true;
    addedCallbacks.forEach((cb) => cb());
    expect(mesh.scale.x).toBe(1);
  });

  test('updateTokenOrientation applies yaw offset and global flip', () => {
    const gm = {
      is3DModeActive: () => true,
      tokenManager: {
        tokenFacingRight: true,
        getTokenFacingRight() {
          return this.tokenFacingRight;
        },
      },
      placedTokens: [],
    };

    const adapter = new Token3DAdapter(gm);
    gm.token3DAdapter = adapter;

    const sprite = { scale: { x: 1 }, rotation: 0 };
    const mesh = {
      userData: { __tt3DToken: true, __ttBaseYaw: Math.PI / 2 },
      rotation: { y: 0 },
    };

    const token = { facingAngle: 0, creature: { sprite }, __threeMesh: mesh };
    gm.placedTokens.push(token);

    adapter.updateTokenOrientation(token);
    expect(mesh.rotation.y).toBeCloseTo(Math.PI / 2);
    expect(sprite.scale.x).toBeCloseTo(1);
    expect(sprite.rotation).toBeCloseTo(0);

    token.facingAngle = Math.PI / 4;
    adapter.updateTokenOrientation(token);
    expect(mesh.rotation.y).toBeCloseTo(Math.PI / 2 + Math.PI / 4);
    expect(sprite.rotation).toBeCloseTo(Math.PI / 4);

    gm.tokenManager.tokenFacingRight = false;
    adapter._lastFacingRight = null;
    adapter._syncFacingDirection();
    expect(mesh.rotation.y).toBeCloseTo(Math.PI / 2 + Math.PI / 4 + Math.PI);
    expect(sprite.scale.x).toBeLessThan(0);
  });

  test('selection indicator attaches when token selected', async () => {
    const three = require('three');
    const gm = {
      is3DModeActive: () => true,
      placedTokens: [],
      tokenManager: {
        tokenFacingRight: true,
        getTokenFacingRight() {
          return this.tokenFacingRight;
        },
      },
    };

    const adapter = new Token3DAdapter(gm);
    adapter._threePromise = Promise.resolve(three);

    const mesh = new three.Mesh(new three.PlaneGeometry(1, 1), new three.MeshBasicMaterial());
    const token = { creature: { sprite: { scale: { x: 1 } } }, __threeMesh: mesh };

    adapter.setSelectedToken(token);
    await Promise.resolve();
    await Promise.resolve();

    expect(token.__ttSelectionIndicator).toBeDefined();
    expect(token.__ttSelectionIndicator.visible).toBe(true);
    expect(mesh.children.includes(token.__ttSelectionIndicator)).toBe(true);
    expect(adapter._originalMaterials.size).toBe(0);

    adapter.setSelectedToken(null);
    expect(token.__ttSelectionIndicator.visible).toBe(false);
    expect(adapter._originalMaterials.size).toBe(0);
  });
});
